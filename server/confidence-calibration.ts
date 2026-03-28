/**
 * Confidence Calibration Layer v2
 *
 * Maps existing bet data (signal_score, hit_rate, edge, season_avg, last_5_avg)
 * into calibrated confidence tiers: SMASH, STRONG, LEAN, AVOID.
 *
 * Instead of relying on edge detection (which fires sparsely),
 * this version uses the rich signal scoring data already computed.
 */

import type { Player } from "@shared/schema";
import { analyzeEdges } from "./edge-detection";
import { calculateSignalScore, loadSignalWeights, type SignalScore } from "./signal-scoring";
import { pool } from "./db";

export type ConfidenceTier = 'SMASH' | 'STRONG' | 'LEAN' | 'AVOID';

export interface CalibrationResult {
  confidenceTier: ConfidenceTier;
  signalAgreement: number;
  calibratedProbability: number;
  agreeingSignals: number;
  totalSignals: number;
  signalDetails: Array<{
    name: string;
    agrees: boolean;
    weight: number;
    accuracy: number;
  }>;
}

/**
 * Evaluate individual signals based on available data.
 * Each signal checks a different aspect of the bet quality.
 */
function evaluateSignals(
  player: Player,
  statType: string,
  line: number,
  recommendation: 'OVER' | 'UNDER',
  hitRate: number,
  seasonAvg: number,
  last5Avg: number | null | undefined,
  signalScore: SignalScore,
  edgeCount: number,
): Array<{ name: string; agrees: boolean; weight: number; accuracy: number }> {
  const signals: Array<{ name: string; agrees: boolean; weight: number; accuracy: number }> = [];

  // 1. Hit Rate Signal - historical accuracy on this stat type
  const hitRateAgrees = hitRate >= 55;
  signals.push({
    name: 'HIT_RATE',
    agrees: hitRateAgrees,
    weight: hitRate >= 65 ? 1.0 : hitRate >= 55 ? 0.7 : 0.3,
    accuracy: Number((hitRate / 100).toFixed(3)),
  });

  // 2. Season Average Signal - does season avg support the direction?
  const seasonDiff = seasonAvg - line;
  const seasonAgrees = recommendation === 'OVER' ? seasonDiff > 0 : seasonDiff < 0;
  const seasonEdgePct = Math.abs(seasonDiff / Math.max(line, 0.1)) * 100;
  signals.push({
    name: 'SEASON_AVG',
    agrees: seasonAgrees,
    weight: seasonEdgePct >= 10 ? 1.0 : seasonEdgePct >= 5 ? 0.7 : 0.4,
    accuracy: 0.56,
  });

  // 3. Recent Form Signal - last 5 games trend
  if (last5Avg && last5Avg > 0) {
    const recentDiff = last5Avg - line;
    const recentAgrees = recommendation === 'OVER' ? recentDiff > 0 : recentDiff < 0;
    const recentEdgePct = Math.abs(recentDiff / Math.max(line, 0.1)) * 100;
    signals.push({
      name: 'RECENT_FORM',
      agrees: recentAgrees,
      weight: recentEdgePct >= 15 ? 1.0 : recentEdgePct >= 7 ? 0.7 : 0.4,
      accuracy: 0.58,
    });

    // 4. Trend Alignment - are season and recent both agreeing?
    const trendAligned = (seasonAvg - line > 0) === (last5Avg - line > 0);
    signals.push({
      name: 'TREND_ALIGNMENT',
      agrees: trendAligned && seasonAgrees,
      weight: trendAligned ? 0.8 : 0.2,
      accuracy: 0.55,
    });
  }

  // 5. Signal Score Confidence - from the signal scoring system
  const highSignalConf = signalScore.signalConfidence === 'HIGH' || signalScore.signalConfidence === 'MEDIUM';
  signals.push({
    name: 'SIGNAL_CONFIDENCE',
    agrees: highSignalConf,
    weight: signalScore.signalConfidence === 'HIGH' ? 1.0 : signalScore.signalConfidence === 'MEDIUM' ? 0.6 : 0.2,
    accuracy: Number(signalScore.avgAccuracy.toFixed(3)),
  });

  // 6. Signal Score Value - weighted score from all signals
  const goodSignalScore = signalScore.weightedScore >= 6;
  signals.push({
    name: 'SIGNAL_SCORE',
    agrees: goodSignalScore,
    weight: signalScore.weightedScore >= 8 ? 1.0 : signalScore.weightedScore >= 6 ? 0.7 : 0.3,
    accuracy: Number(signalScore.avgAccuracy.toFixed(3)),
  });

  // 7. Edge Detection Signal - fires when matchup-based edges exist
  const hasEdges = edgeCount >= 2;
  signals.push({
    name: 'EDGE_DETECTION',
    agrees: hasEdges,
    weight: edgeCount >= 4 ? 1.0 : edgeCount >= 2 ? 0.6 : 0.2,
    accuracy: 0.57,
  });

  // 8. Edge Size Signal - how far is the projected value from the line?
  const projectedValue = last5Avg && last5Avg > 0
    ? seasonAvg * 0.4 + last5Avg * 0.6
    : seasonAvg;
  const edgePct = Math.abs((projectedValue - line) / Math.max(line, 0.1)) * 100;
  const directionCorrect = recommendation === 'OVER'
    ? projectedValue > line
    : projectedValue < line;
  signals.push({
    name: 'EDGE_SIZE',
    agrees: directionCorrect && edgePct >= 3,
    weight: edgePct >= 15 ? 1.0 : edgePct >= 8 ? 0.7 : edgePct >= 3 ? 0.5 : 0.1,
    accuracy: 0.55,
  });

  return signals;
}

/**
 * Classify tier based on agreement percentage and edge.
 * Tuned for realistic distributions (not all AVOID).
 */
function classifyTier(
  agreementPct: number,
  edgePct: number,
  hitRate: number,
  signalScore: SignalScore,
): ConfidenceTier {
  const absEdge = Math.abs(edgePct);

  // SMASH: Strong agreement + good edge + solid hit rate
  if (agreementPct >= 75 && absEdge >= 8 && hitRate >= 58) {
    return 'SMASH';
  }
  // Also SMASH if exceptional agreement even with moderate edge
  if (agreementPct >= 85 && absEdge >= 5 && hitRate >= 55) {
    return 'SMASH';
  }

  // STRONG: Good agreement + meaningful edge
  if (agreementPct >= 60 && absEdge >= 5 && hitRate >= 52) {
    return 'STRONG';
  }
  // Also STRONG with high hit rate even with moderate agreement
  if (agreementPct >= 50 && absEdge >= 5 && hitRate >= 60) {
    return 'STRONG';
  }

  // LEAN: Majority agreeing + some edge
  if (agreementPct >= 40 && absEdge >= 2) {
    return 'LEAN';
  }
  // Also LEAN if strong hit rate regardless
  if (hitRate >= 55 && absEdge >= 2) {
    return 'LEAN';
  }

  // AVOID: weak signals
  return 'AVOID';
}

/**
 * Calibrate probability based on multiple factors
 */
function calibrateProbability(
  agreementPct: number,
  edgePct: number,
  hitRate: number,
  signalScore: SignalScore,
): number {
  const baseProb = Math.max(0.35, Math.min(0.80, hitRate / 100));
  const agreementBoost = Math.max(0, (agreementPct - 40) / 100) * 0.10;
  const edgeBoost = Math.min(0.08, Math.abs(edgePct) / 100 * 0.4);
  const accuracyBoost = Math.max(0, (signalScore.avgAccuracy - 0.5)) * 0.10;
  const calibrated = Math.min(0.82, baseProb + agreementBoost + edgeBoost + accuracyBoost);
  return Number(calibrated.toFixed(4));
}

/**
 * Main calibration function
 */
export async function calibrateBet(
  player: Player,
  statType: string,
  line: number,
  recommendation: 'OVER' | 'UNDER',
  hitRate: number,
  seasonAvg: number,
  last5Avg: number | null | undefined,
): Promise<CalibrationResult> {
  await loadSignalWeights(pool);

  // Run edge detection
  const edgeAnalysis = analyzeEdges(player, statType, recommendation, hitRate);

  // Calculate signal score
  const signalScore = calculateSignalScore(
    player, statType, recommendation, hitRate, edgeAnalysis.edges,
  );

  // Evaluate all signals
  const signals = evaluateSignals(
    player, statType, line, recommendation,
    hitRate, seasonAvg, last5Avg, signalScore, edgeAnalysis.edges.length,
  );

  // Count agreeing signals (weighted)
  const agreeingSignals = signals.filter(s => s.agrees);
  const totalSignals = signals.length;
  
  // Weighted agreement: sum of weights for agreeing / sum of all weights
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const agreeingWeight = agreeingSignals.reduce((sum, s) => sum + s.weight, 0);
  const agreementPct = totalWeight > 0 ? (agreeingWeight / totalWeight) * 100 : 0;

  // Calculate edge
  const projectedValue = last5Avg && last5Avg > 0
    ? seasonAvg * 0.4 + last5Avg * 0.6
    : seasonAvg;
  const edgePct = ((projectedValue - line) / Math.max(line, 0.1)) * 100;
  const effectiveEdge = recommendation === 'OVER' ? edgePct : -edgePct;

  // Classify tier
  const confidenceTier = classifyTier(agreementPct, effectiveEdge, hitRate, signalScore);

  // Calibrate probability
  const calibratedProbability = calibrateProbability(
    agreementPct, effectiveEdge, hitRate, signalScore,
  );

  return {
    confidenceTier,
    signalAgreement: Number((agreementPct / 100).toFixed(4)),
    calibratedProbability,
    agreeingSignals: agreeingSignals.length,
    totalSignals,
    signalDetails: agreeingSignals,
  };
}

/**
 * Batch calibrate multiple bets
 */
export async function calibrateBets(
  bets: Array<{
    player: Player;
    statType: string;
    line: number;
    recommendation: 'OVER' | 'UNDER';
    hitRate: number;
    seasonAvg: number;
    last5Avg: number | null | undefined;
  }>,
): Promise<CalibrationResult[]> {
  await loadSignalWeights(pool);
  const results: CalibrationResult[] = [];
  for (const bet of bets) {
    results.push(await calibrateBet(
      bet.player, bet.statType, bet.line,
      bet.recommendation, bet.hitRate, bet.seasonAvg, bet.last5Avg,
    ));
  }
  return results;
}

