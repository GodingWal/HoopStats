/**
 * Expected Value & Bet Sizing Calculator
 *
 * Provides EV calculation, implied probability conversion,
 * and Kelly Criterion bet sizing.
 */

/**
 * Convert American odds to implied probability (0-1).
 *
 * -110 → 0.524 (52.4%)
 * +150 → 0.400 (40.0%)
 * -200 → 0.667 (66.7%)
 */
export function impliedProbability(americanOdds: number): number {
  if (americanOdds < 0) {
    return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100);
  } else {
    return 100 / (americanOdds + 100);
  }
}

/**
 * Convert implied probability (0-1) to American odds.
 *
 * 0.524 → -110
 * 0.400 → +150
 */
export function probabilityToAmericanOdds(prob: number): number {
  if (prob <= 0 || prob >= 1) return 0;
  if (prob >= 0.5) {
    return Math.round(-100 * prob / (1 - prob));
  } else {
    return Math.round(100 * (1 - prob) / prob);
  }
}

/**
 * Calculate Expected Value of a bet.
 *
 * @param estimatedProb Our estimated probability of winning (0-1)
 * @param americanOdds The odds being offered
 * @returns EV as a fraction of the stake (e.g., 0.05 = 5% EV)
 */
export function calculateEV(estimatedProb: number, americanOdds: number): number {
  let decimalOdds: number;
  if (americanOdds < 0) {
    decimalOdds = 1 + (100 / Math.abs(americanOdds));
  } else {
    decimalOdds = 1 + (americanOdds / 100);
  }

  // EV = (prob * payout) - (1 - prob) * stake
  // With decimal odds and stake=1: EV = (prob * decimalOdds) - 1
  return (estimatedProb * decimalOdds) - 1;
}

/**
 * Calculate Kelly Criterion optimal bet size.
 *
 * @param estimatedProb Our estimated probability of winning (0-1)
 * @param americanOdds The odds being offered
 * @returns Optimal fraction of bankroll to bet (0-1). Returns 0 if no edge.
 */
export function kellyFraction(estimatedProb: number, americanOdds: number): number {
  let decimalOdds: number;
  if (americanOdds < 0) {
    decimalOdds = 1 + (100 / Math.abs(americanOdds));
  } else {
    decimalOdds = 1 + (americanOdds / 100);
  }

  const b = decimalOdds - 1; // Net odds (what you win per unit staked)
  const p = estimatedProb;
  const q = 1 - p;

  // Kelly formula: f = (bp - q) / b
  const fraction = (b * p - q) / b;

  return Math.max(0, fraction);
}

/**
 * Fractional Kelly - more conservative bet sizing.
 *
 * @param kellyMultiplier Fraction of full Kelly (e.g., 0.25 for quarter Kelly)
 * @param estimatedProb Our estimated probability
 * @param americanOdds The odds
 * @returns Recommended bet size as fraction of bankroll
 */
export function fractionalKelly(
  kellyMultiplier: number,
  estimatedProb: number,
  americanOdds: number
): number {
  return kellyFraction(estimatedProb, americanOdds) * kellyMultiplier;
}

/**
 * Determine if a bet has positive expected value.
 *
 * @param estimatedProb Our estimated win probability (0-1)
 * @param americanOdds Offered odds (default -110 for PrizePicks standard)
 * @param minEdge Minimum EV threshold to consider (default 0.05 = 5%)
 * @returns { hasEdge, ev, kelly, impliedProb }
 */
export function evaluateBetValue(
  estimatedProb: number,
  americanOdds: number = -110,
  minEdge: number = 0.05
): {
  hasEdge: boolean;
  ev: number;
  kelly: number;
  quarterKelly: number;
  impliedProb: number;
  edgeOverMarket: number;
} {
  const ip = impliedProbability(americanOdds);
  const ev = calculateEV(estimatedProb, americanOdds);
  const kelly = kellyFraction(estimatedProb, americanOdds);
  const quarterKelly = kelly * 0.25;

  return {
    hasEdge: ev >= minEdge,
    ev: Math.round(ev * 1000) / 1000,
    kelly: Math.round(kelly * 1000) / 1000,
    quarterKelly: Math.round(quarterKelly * 1000) / 1000,
    impliedProb: Math.round(ip * 1000) / 1000,
    edgeOverMarket: Math.round((estimatedProb - ip) * 1000) / 1000,
  };
}
