/**
 * Signal-Based Scoring System
 * 
 * Loads learned signal weights from backtest and uses them to score bets
 * based on which signals agree with the recommendation.
 */

import { Pool } from 'pg';
import type { Player } from "@shared/schema";

// Cached weights per stat type
let cachedWeights: Record<string, Record<string, { weight: number; accuracy: number; sample_size: number }>> = {};
let weightsCacheTime: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Signal configuration - maps edge types to their signal equivalents
 */
const EDGE_TO_SIGNAL_MAP: Record<string, string> = {
    'STAR_OUT': 'injury_alpha',
    'STAR_OUT_POTENTIAL': 'injury_alpha',
    'BACK_TO_BACK': 'b2b',
    'BLOWOUT_RISK': 'blowout',
    'PACE_MATCHUP': 'pace',
    'BAD_DEFENSE': 'defense',
    'MINUTES_STABILITY': 'fatigue',
    'HOME_ROAD_SPLIT': 'home_away',
    'RECENT_FORM': 'recent_form',
    'CLV': 'clv_tracker',
    'REFEREE': 'referee',
    'LINE_MOVEMENT': 'line_movement',
    'MATCHUP_HISTORY': 'matchup_history',
    'DEFENDER': 'defender_matchup',
};

/**
 * Load signal weights from database
 */
export async function loadSignalWeights(pool: Pool | null): Promise<void> {
    if (!pool) return;

    const now = Date.now();
    if (cachedWeights && Object.keys(cachedWeights).length > 0 && now - weightsCacheTime < CACHE_TTL_MS) {
        return; // Use cached weights
    }

    try {
        const result = await pool.query(`
      SELECT stat_type, weights
      FROM signal_weights
      WHERE valid_until IS NULL
    `);

        cachedWeights = {};
        for (const row of result.rows) {
            const statType = row.stat_type;
            const weights = typeof row.weights === 'string' ? JSON.parse(row.weights) : row.weights;

            cachedWeights[statType] = {};
            for (const [signalName, data] of Object.entries(weights as Record<string, any>)) {
                cachedWeights[statType][signalName] = {
                    weight: data.weight || 0,
                    accuracy: data.accuracy || 0.5,
                    sample_size: data.sample_size || 0,
                };
            }
        }

        weightsCacheTime = now;
        console.log(`[SignalScoring] Loaded weights for ${Object.keys(cachedWeights).length} stat types`);
    } catch (error: any) {
        console.error('[SignalScoring] Error loading weights:', error.message);
    }
}

/**
 * Get weights for a specific stat type
 */
export function getWeightsForStatType(statType: string): Record<string, { weight: number; accuracy: number; sample_size: number }> {
    // Normalize stat type
    const normalized = normalizeStatType(statType);
    return cachedWeights[normalized] || getDefaultWeights();
}

/**
 * Normalize stat type to match what's stored in database
 */
function normalizeStatType(statType: string): string {
    const mapping: Record<string, string> = {
        'PTS': 'Points',
        'REB': 'Rebounds',
        'AST': 'Assists',
        'PRA': 'Points',  // Use Points weights for combos
        'PR': 'Points',
        'PA': 'Points',
        'RA': 'Rebounds',
        'FG3M': 'Points',
        'STL': 'Points',
        'BLK': 'Rebounds',
        'TO': 'Assists',
        'TOV': 'Assists',
    };
    return mapping[statType] || 'Points';
}

/**
 * Default weights if database is unavailable
 */
function getDefaultWeights(): Record<string, { weight: number; accuracy: number; sample_size: number }> {
    return {
        injury_alpha: { weight: 0.18, accuracy: 0.5, sample_size: 0 },
        clv_tracker: { weight: 0.12, accuracy: 0.5, sample_size: 0 },
        b2b: { weight: 0.10, accuracy: 0.5, sample_size: 0 },
        line_movement: { weight: 0.10, accuracy: 0.5, sample_size: 0 },
        defender_matchup: { weight: 0.08, accuracy: 0.5, sample_size: 0 },
        pace: { weight: 0.08, accuracy: 0.5, sample_size: 0 },
        defense: { weight: 0.07, accuracy: 0.5, sample_size: 0 },
        blowout: { weight: 0.07, accuracy: 0.5, sample_size: 0 },
        fatigue: { weight: 0.06, accuracy: 0.5, sample_size: 0 },
        matchup_history: { weight: 0.05, accuracy: 0.5, sample_size: 0 },
        referee: { weight: 0.04, accuracy: 0.5, sample_size: 0 },
        home_away: { weight: 0.03, accuracy: 0.5, sample_size: 0 },
        recent_form: { weight: 0.02, accuracy: 0.5, sample_size: 0 },
    };
}

export interface SignalScore {
    /** Total weighted signal score (0-1) */
    signalScore: number;
    /** Number of active signals */
    activeSignals: number;
    /** Total weight of agreeing signals */
    agreeingWeight: number;
    /** Average accuracy of active signals */
    avgAccuracy: number;
    /** List of active signal names */
    signals: string[];
    /** Whether signals mostly agree (>70% weight in same direction) */
    signalsAgree: boolean;
    /** Confidence tier based on signal quality */
    signalConfidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Calculate signal-based score for a bet
 * 
 * This uses the learned weights from backtest to score how confident
 * the model is in this bet direction.
 */
export function calculateSignalScore(
    player: Player,
    statType: string,
    recommendation: 'OVER' | 'UNDER',
    hitRate: number,
    detectedEdges: Array<{ type: string; score: number }>
): SignalScore {
    const weights = getWeightsForStatType(statType);

    let totalWeight = 0;
    let totalAccuracy = 0;
    let activeCount = 0;
    const activeSignals: string[] = [];

    // Map detected edges to signals and calculate weighted score
    for (const edge of detectedEdges) {
        const signalName = EDGE_TO_SIGNAL_MAP[edge.type];
        if (signalName && weights[signalName]) {
            const signalWeight = weights[signalName];

            // Only count signals with positive weight
            if (signalWeight.weight > 0) {
                totalWeight += signalWeight.weight;
                totalAccuracy += signalWeight.accuracy * signalWeight.weight;
                activeCount++;
                activeSignals.push(signalName);
            }
        }
    }

    // Add bonus for hit rate alignment (if hit rate strongly supports recommendation)
    let hitRateBonus = 0;
    if (recommendation === 'OVER' && hitRate >= 65) {
        hitRateBonus = (hitRate - 50) / 100; // 0.15 bonus for 65% hit rate
    } else if (recommendation === 'UNDER' && hitRate <= 35) {
        hitRateBonus = (50 - hitRate) / 100;
    }

    // Calculate final signal score
    const signalScore = Math.min(1, totalWeight + hitRateBonus);
    const avgAccuracy = activeCount > 0 ? totalAccuracy / totalWeight : 0.5;

    // Determine confidence tier
    let signalConfidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
    if (signalScore >= 0.35 && avgAccuracy >= 0.60) {
        signalConfidence = 'HIGH';
    } else if (signalScore >= 0.20 && avgAccuracy >= 0.55) {
        signalConfidence = 'MEDIUM';
    }

    return {
        signalScore,
        activeSignals: activeCount,
        agreeingWeight: totalWeight,
        avgAccuracy,
        signals: activeSignals,
        signalsAgree: activeCount <= 1 || totalWeight >= 0.3,
        signalConfidence,
    };
}

/**
 * Filter function to only keep bets with strong signal support
 */
export function hasStrongSignalSupport(signalScore: SignalScore): boolean {
    // Keep bets where:
    // 1. Signal confidence is HIGH or MEDIUM
    // 2. At least 2 signals agree OR one high-weight signal
    // 3. Average accuracy is above 55%

    if (signalScore.signalConfidence === 'HIGH') return true;
    if (signalScore.signalConfidence === 'MEDIUM' && signalScore.avgAccuracy >= 0.55) return true;
    if (signalScore.agreeingWeight >= 0.30) return true;
    if (signalScore.activeSignals >= 2 && signalScore.avgAccuracy >= 0.55) return true;

    return false;
}

/**
 * Get a human-readable description of the signal support
 */
export function getSignalDescription(signalScore: SignalScore): string {
    if (signalScore.activeSignals === 0) {
        return 'No signal support';
    }

    const signalNames = signalScore.signals.map(s => {
        const labels: Record<string, string> = {
            injury_alpha: 'Injury Alpha',
            b2b: 'B2B Fatigue',
            pace: 'Pace Matchup',
            defense: 'Defense',
            blowout: 'Blowout Risk',
            recent_form: 'Recent Form',
            home_away: 'Home/Away',
            clv_tracker: 'CLV',
            referee: 'Referee',
            line_movement: 'Line Movement',
            matchup_history: 'Matchup History',
            defender_matchup: 'Defender',
            fatigue: 'Fatigue',
        };
        return labels[s] || s;
    });

    const accuracyPct = Math.round(signalScore.avgAccuracy * 100);

    if (signalScore.signalConfidence === 'HIGH') {
        return `Strong signal support: ${signalNames.join(', ')} (${accuracyPct}% accuracy)`;
    } else if (signalScore.signalConfidence === 'MEDIUM') {
        return `Signal support: ${signalNames.join(', ')} (${accuracyPct}% accuracy)`;
    }

    return `Weak signals: ${signalNames.join(', ')}`;
}
