/**
 * Confidence Calibration Layer
 *
 * Maps signal agreement, edge size, and historical accuracy
 * into calibrated confidence tiers: SMASH, STRONG, LEAN, AVOID.
 *
 * Uses the existing signal scoring system and edge detection
 * to count how many independent signals agree on a direction.
 */

import type { Player } from "@shared/schema";
import { analyzeEdges } from "./edge-detection";
import { calculateSignalScore, loadSignalWeights, type SignalScore } from "./signal-scoring";
import { pool } from "./db";

export type ConfidenceTier = 'SMASH' | 'STRONG' | 'LEAN' | 'AVOID';

export interface CalibrationResult {
  /** SMASH / STRONG / LEAN / AVOID */
  confidenceTier: ConfidenceTier;
  /** 0-1: fraction of signals agreeing on the direction */
  signalAgreement: number;
  /** Calibrated win probability (0-1) */
  calibratedProbability: number;
  /** Number of signals that agree with the recommendation */
  agreeingSignals: number;
  /** Total number of signals evaluated */
  totalSignals: number;
  /** Details per signal for transparency */
  signalDetails: Array<{
    name: string;
    agrees: boolean;
    weight: number;
    accuracy: number;
  }>;
}

/**
 * All signal types we evaluate, mapped from edge detection types
 */
const ALL_SIGNAL_TYPES = [
  'STAR_OUT', 'BACK_TO_BACK', 'BLOWOUT_RISK', 'PACE_MATCHUP',
  'BAD_DEFENSE', 'MINUTES_STABILITY', 'RECENT_FORM', 'HOME_ROAD_SPLIT',
  'REST_DAYS', 'MINUTES_PROJECTION', 'USAGE_REDISTRIBUTION', 'POSITIONAL_DEFENSE',
] as const;

/**
 * Calculate the edge percentage between the projected value and the line
 */
function calculateEdgePct(seasonAvg: number, last5Avg: number | null | undefined, line: number, recommendation: 'OVER' | 'UNDER'): number {
  // Use a weighted blend of season and recent averages
  const projectedValue = last5Avg && last5Avg > 0
    ? seasonAvg * 0.4 + last5Avg * 0.6
    : seasonAvg;

  if (line === 0) return 0;

  const rawEdge = ((projectedValue - line) / line) * 100;

  // Edge is positive when it aligns with recommendation
  if (recommendation === 'OVER') {
    return rawEdge; // Positive means projected > line (good for OVER)
  } else {
    return -rawEdge; // Positive means projected < line (good for UNDER)
  }
}

/**
 * Determine confidence tier from signal agreement and edge size.
 *
 * Tiers:
 *   SMASH  - 80%+ signals agree, edge > 10%
 *   STRONG - 65%+ signals agree, edge > 5%
 *   LEAN   - 50%+ signals agree, edge > 2%
 *   AVOID  - signals disagree or edge < 2%
 */
function classifyTier(
  signalAgreementPct: number,
  edgePct: number,
  signalScore: SignalScore,
): ConfidenceTier {
  const absEdge = Math.abs(edgePct);

  // SMASH: overwhelming agreement + large edge
  if (signalAgreementPct >= 80 && absEdge >= 10 && signalScore.signalConfidence !== 'LOW') {
    return 'SMASH';
  }

  // STRONG: solid agreement + meaningful edge
  if (signalAgreementPct >= 65 && absEdge >= 5 && signalScore.avgAccuracy >= 0.54) {
    return 'STRONG';
  }

  // LEAN: majority agreement + some edge
  if (signalAgreementPct >= 50 && absEdge >= 2) {
    return 'LEAN';
  }

  // AVOID: anything else
  return 'AVOID';
}

/**
 * Map signal agreement percentage to a calibrated probability.
 *
 * Based on empirical findings from signal_results:
 *   - matchup_history (3434 picks): 62.9% win rate
 *   - rest_days (10068 picks): 50.2%
 *   - defender_matchup (3386 picks): 48.9%
 *
 * When multiple signals agree the probability compounds.
 * This is a logistic-style calibration curve.
 */
function calibrateProbability(
  signalAgreementPct: number,
  edgePct: number,
  signalScore: SignalScore,
  hitRate: number,
): number {
  // Start from base hit-rate probability
  const baseProb = Math.max(0.3, Math.min(0.85, hitRate / 100));

  // Signal agreement boost: each 10% agreement above 50% adds confidence
  const agreementBoost = Math.max(0, (signalAgreementPct - 50) / 100) * 0.12;

  // Edge size boost: larger edges are more reliable
  const edgeBoost = Math.min(0.10, Math.abs(edgePct) / 100 * 0.5);

  // Signal accuracy boost
  const accuracyBoost = Math.max(0, (signalScore.avgAccuracy - 0.5)) * 0.15;

  // Combine with ceiling
  const calibrated = Math.min(0.85, baseProb + agreementBoost + edgeBoost + accuracyBoost);

  return Number(calibrated.toFixed(4));
}

/**
 * Main calibration function - calculates confidence tier for a bet.
 *
 * Integrates signal scoring, edge detection, and hit rate data
 * to produce a calibrated confidence assessment.
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
  // Ensure signal weights are loaded
  await loadSignalWeights(pool);

  // Run edge detection to see which signals fire
  const edgeAnalysis = analyzeEdges(player, statType, recommendation, hitRate);

  // Calculate signal score using the existing system
  const signalScore = calculateSignalScore(
    player, statType, recommendation, hitRate, edgeAnalysis.edges,
  );

  // Count agreeing vs total signals
  const firedSignals = new Set(edgeAnalysis.edges.map(e => e.type));
  const totalEvaluated = ALL_SIGNAL_TYPES.length;
  const agreeingCount = firedSignals.size; // All fired signals agree (they only fire when they support the direction)

  // Signal agreement as a percentage (of total possible signals)
  // We weight this: fired signals with high scores count more
  let weightedAgreement = 0;
  let totalPossibleWeight = totalEvaluated; // Each signal could contribute 1

  for (const edge of edgeAnalysis.edges) {
    // Score is 1-10; normalize to 0-1 contribution
    weightedAgreement += Math.min(1, edge.score / 5);
  }

  const signalAgreementPct = totalPossibleWeight > 0
    ? (weightedAgreement / totalPossibleWeight) * 100
    : 0;

  // Also compute a simpler ratio for display
  const simpleAgreementPct = totalEvaluated > 0
    ? (agreeingCount / totalEvaluated) * 100
    : 0;

  // Use the higher of weighted and simple agreement (weighted rewards strong signals)
  const effectiveAgreement = Math.max(signalAgreementPct, simpleAgreementPct);

  // Calculate edge percentage
  const edgePct = calculateEdgePct(seasonAvg, last5Avg, line, recommendation);

  // Classify into tier
  const confidenceTier = classifyTier(effectiveAgreement, edgePct, signalScore);

  // Calibrate probability
  const calibratedProbability = calibrateProbability(
    effectiveAgreement, edgePct, signalScore, hitRate,
  );

  // Build signal details
  const signalDetails = ALL_SIGNAL_TYPES.map(sigType => {
    const edge = edgeAnalysis.edges.find(e => e.type === sigType);
    return {
      name: sigType,
      agrees: !!edge,
      weight: edge ? edge.score / 10 : 0,
      accuracy: signalScore.avgAccuracy,
    };
  });

  return {
    confidenceTier,
    signalAgreement: Number((effectiveAgreement / 100).toFixed(4)),
    calibratedProbability,
    agreeingSignals: agreeingCount,
    totalSignals: totalEvaluated,
    signalDetails: signalDetails.filter(s => s.agrees), // Only return active signals
  };
}

/**
 * Batch calibrate multiple bets efficiently.
 * Loads signal weights once, then calibrates each bet.
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
  // Load weights once
  await loadSignalWeights(pool);

  const results: CalibrationResult[] = [];
  for (const bet of bets) {
    const result = await calibrateBet(
      bet.player, bet.statType, bet.line,
      bet.recommendation, bet.hitRate, bet.seasonAvg, bet.last5Avg,
    );
    results.push(result);
  }
  return results;
}

