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
import { analyzeEdges, type EdgeAnalysis } from "./edge-detection";
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
  const seasonEdgePct = Math.abs(seasonDiff / Math.max(seasonAvg, 0.5)) * 100;
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
    const recentEdgePct = Math.abs(recentDiff / Math.max(seasonAvg, 0.5)) * 100;
    signals.push({
      name: 'RECENT_FORM',
      agrees: recentAgrees,
      weight: recentEdgePct >= 15 ? 1.0 : recentEdgePct >= 7 ? 0.7 : 0.4,
      accuracy: 0.58,
    });

    // 4. Trend Alignment - is recent form trending in the direction of the recommendation?
    // Checks whether last5Avg is moving toward the recommendation vs season baseline,
    // independent of SEASON_AVG to avoid double-counting.
    const trendAligned = recommendation === 'OVER' ? last5Avg > seasonAvg : last5Avg < seasonAvg;
    signals.push({
      name: 'TREND_ALIGNMENT',
      agrees: trendAligned,
      weight: 1,  // equal weight regardless of agreement
      accuracy: 0.55,
    });
  }

  // 5. Signal Score Value - weighted score from all signals
  // (SIGNAL_CONFIDENCE removed: derived from same signalScore object — double-counts.)
  const goodSignalScore = signalScore.weightedScore >= 6;
  signals.push({
    name: 'SIGNAL_SCORE',
    agrees: goodSignalScore,
    weight: signalScore.weightedScore >= 8 ? 1.0 : signalScore.weightedScore >= 6 ? 0.7 : 0.3,
    accuracy: Number(signalScore.avgAccuracy.toFixed(3)),
  });

  // 6. Edge Detection Signal - fires when matchup-based edges exist
  const hasEdges = edgeCount >= 2;
  signals.push({
    name: 'EDGE_DETECTION',
    agrees: hasEdges,
    weight: edgeCount >= 4 ? 1.0 : edgeCount >= 2 ? 0.6 : 0.2,
    accuracy: 0.57,
  });

  // 7. Edge Size Signal - how far is the projected value from the line?
  const projectedValue = last5Avg && last5Avg > 0
    ? seasonAvg * 0.4 + last5Avg * 0.6
    : seasonAvg;
  const edgePct = Math.abs((projectedValue - line) / Math.max(seasonAvg, 0.5)) * 100;
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
 *
 * SMASH additionally requires at least 4 signals to have actually fired.
 * A 2-signal SMASH is a statistical coincidence, not genuine conviction.
 * If fewer than 4 signals fired, the best achievable tier is STRONG.
 */
function classifyTier(
  agreementPct: number,
  edgePct: number,
  hitRate: number,
  signalScore: SignalScore,
  agreeingSignalsCount: number,
): ConfidenceTier {
  const absEdge = Math.abs(edgePct);
  const canSmash = agreeingSignalsCount >= 4;

  // SMASH: Strong agreement + good edge + solid hit rate + minimum 4 fired signals
  if (canSmash && agreementPct >= 75 && absEdge >= 8 && hitRate >= 58) {
    return 'SMASH';
  }
  // Also SMASH if exceptional agreement even with moderate edge (still requires 4 signals)
  if (canSmash && agreementPct >= 85 && absEdge >= 5 && hitRate >= 55) {
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
 * Determine the calibration ceiling based on signal agreement strength.
 * Raises the default 0.82 cap when the model has high conviction
 * (many signals all pointing the same direction).
 */
function getCalibrationCeiling(agreementPct: number, agreeingSignals: number): number {
  const signalAgreement = agreementPct / 100;
  if (signalAgreement >= 0.90 && agreeingSignals >= 6) return 0.90;
  if (signalAgreement >= 0.85 && agreeingSignals >= 5) return 0.87;
  return 0.82;
}

/**
 * Compute hit rate over the player's last N recent games for a given stat/line.
 * Returns null when fewer than minGames are available.
 */
function computeRecentHitRate(
  player: Player,
  statType: string,
  line: number,
  recommendation: 'OVER' | 'UNDER',
  maxGames = 10,
  minGames = 5,
): number | null {
  const games = player.recent_games;
  if (!games || games.length < minGames) return null;

  const statKey = statType as keyof typeof games[0];
  const slice = games.slice(0, maxGames);
  let hits = 0;

  for (const g of slice) {
    const val = g[statKey];
    if (typeof val !== 'number') continue;
    if (recommendation === 'OVER') {
      if (val > line) hits++;
    } else {
      if (val < line) hits++;
    }
  }

  return (hits / slice.length) * 100;
}

/**
 * Calibrate probability based on multiple factors.
 * Uses a recency-weighted hit rate (60% last-10, 40% season) as the base
 * probability so hot/cold streaks are reflected immediately.
 */
function calibrateProbability(
  agreementPct: number,
  edgePct: number,
  hitRate: number,
  signalScore: SignalScore,
  agreeingSignals: number,
  last10HitRate: number | null,
): number {
  // Blend recent form into the base probability.
  // Falls back to season hit rate when last10 data isn't available.
  const blendedHitRate = last10HitRate !== null
    ? 0.6 * last10HitRate + 0.4 * hitRate
    : hitRate;
  const baseProb = Math.max(0.35, Math.min(0.80, blendedHitRate / 100));
  const agreementBoost = Math.max(0, (agreementPct - 40) / 100) * 0.10;
  const edgeBoost = Math.min(0.08, Math.abs(edgePct) / 100 * 0.4);
  const accuracyBoost = Math.max(0, (signalScore.avgAccuracy - 0.5)) * 0.10;
  const ceiling = getCalibrationCeiling(agreementPct, agreeingSignals);
  const calibrated = Math.min(ceiling, baseProb + agreementBoost + edgeBoost + accuracyBoost);
  return Number(calibrated.toFixed(4));
}

/**
 * Main calibration function.
 * @param precomputedEdgeAnalysis - Fix 4: pass already-computed edges to avoid a second
 *   analyzeEdges() call (generateBetsFromPrizePicks already ran it once).
 */
export async function calibrateBet(
  player: Player,
  statType: string,
  line: number,
  recommendation: 'OVER' | 'UNDER',
  hitRate: number,
  seasonAvg: number,
  last5Avg: number | null | undefined,
  precomputedEdgeAnalysis?: EdgeAnalysis | null,
): Promise<CalibrationResult> {
  await loadSignalWeights(pool);

  // Fix 4: reuse already-computed edges instead of running analyzeEdges() a second time
  const edgeAnalysis = precomputedEdgeAnalysis ?? analyzeEdges(player, statType, recommendation, hitRate);

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
  const edgePct = ((projectedValue - line) / Math.max(seasonAvg, 0.5)) * 100;
  const effectiveEdge = recommendation === 'OVER' ? edgePct : -edgePct;

  // Classify tier (requires 4+ agreeing signals for SMASH)
  const rawTier = classifyTier(agreementPct, effectiveEdge, hitRate, signalScore, agreeingSignals.length);

  // Recency-weighted hit rate: blends last-10-game performance with season average.
  // Catches streaks/slumps the full-season hit rate misses.
  const last10HitRate = computeRecentHitRate(player, statType, line, recommendation);

  // Calibrate probability (ceiling rises with high signal agreement)
  const calibratedProbability = calibrateProbability(
    agreementPct, effectiveEdge, hitRate, signalScore, agreeingSignals.length, last10HitRate,
  );

  // Minimum confidence gate: near-coin-flip probability → not a real edge → AVOID.
  // Prevents weak signal clusters from producing LEAN/STRONG calls when the
  // underlying probability estimate is essentially 50/50.
  const confidenceTier: ConfidenceTier = calibratedProbability < 0.52 ? 'AVOID' : rawTier;

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

