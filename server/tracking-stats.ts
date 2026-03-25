/**
 * Tracking-Derived Stats Service
 *
 * Computes advanced tracking stats from available player data:
 * 1. Shot Quality (qSQ) - expected points, shot quality delta, regression signals
 * 2. Defensive Metrics - Aggression+, Variance+, scheme detection
 * 3. Synergy/Lineup - teammate combo impact, minutes projection, opponent clusters
 */

import type { Player, TrackingStats, ShotQuality, DefensiveMatchup, SynergyLineup } from "@shared/schema";

// Defensive scheme profiles for NBA teams (2024-25 tendencies)
const TEAM_SCHEMES: Record<string, string> = {
  BOS: "switch", CLE: "drop", OKC: "blitz", NYK: "switch",
  MIL: "drop", IND: "hedge", MIA: "zone", ORL: "switch",
  PHI: "drop", CHI: "hedge", ATL: "hedge", BKN: "drop",
  TOR: "hedge", DET: "drop", CHA: "drop", WAS: "drop",
  MIN: "drop", DEN: "hedge", DAL: "switch", LAC: "switch",
  PHX: "blitz", HOU: "switch", SAC: "hedge", GSW: "switch",
  LAL: "hedge", NOP: "blitz", MEM: "blitz", SAS: "drop",
  POR: "drop", UTA: "drop",
};

// Scheme aggression scores (Aggression+)
const SCHEME_AGGRESSION: Record<string, number> = {
  blitz: 85, hedge: 65, switch: 50, drop: 30, zone: 40,
};

// Scheme variance scores (Variance+)
const SCHEME_VARIANCE: Record<string, number> = {
  blitz: 80, zone: 70, switch: 60, hedge: 45, drop: 35,
};

// Scheme stat impact multipliers
const SCHEME_IMPACTS: Record<string, Record<string, number>> = {
  blitz: { PTS: 0.97, AST: 1.08, TOV: 1.15, FG3M: 1.05, REB: 1.02 },
  drop: { PTS: 1.03, AST: 0.96, TOV: 0.95, FG3M: 0.92, REB: 0.98 },
  switch: { PTS: 1.05, AST: 0.98, TOV: 0.97, FG3M: 1.04, REB: 1.03 },
  hedge: { PTS: 0.99, AST: 1.02, TOV: 1.05, FG3M: 0.98, REB: 1.00 },
  zone: { PTS: 0.96, AST: 0.94, TOV: 0.93, FG3M: 1.10, REB: 1.05 },
};

// League-average shot type eFG%
const SHOT_TYPE_EFG = {
  rim: 0.63,
  short_mid: 0.41,
  long_mid: 0.40,
  three: 0.53,
};

// Opponent defensive archetype clusters
const OPPONENT_CLUSTERS: Record<string, string> = {
  BOS: "elite-switch", CLE: "rim-protect", OKC: "pressure-turnover",
  NYK: "physical-switch", MIL: "rim-protect", IND: "pace-push",
  MIA: "zone-versatile", ORL: "length-switch", PHI: "rim-protect",
  CHI: "neutral", ATL: "pace-push", BKN: "neutral",
  TOR: "length-switch", DET: "developing", CHA: "developing",
  WAS: "developing", MIN: "rim-protect", DEN: "smart-hedge",
  DAL: "elite-switch", LAC: "elite-switch", PHX: "pressure-turnover",
  HOU: "length-switch", SAC: "pace-push", GSW: "elite-switch",
  LAL: "smart-hedge", NOP: "pressure-turnover", MEM: "pressure-turnover",
  SAS: "developing", POR: "neutral", UTA: "neutral",
};

/**
 * Compute shot quality metrics from game log data.
 */
function computeShotQuality(player: Player): ShotQuality {
  const games = player.game_logs || player.recent_games;
  if (!games || games.length < 3) {
    return defaultShotQuality();
  }

  const last10 = games.slice(0, 10);
  const last5 = games.slice(0, 5);

  // Compute shooting stats from game logs
  const totalPts = last10.reduce((s, g) => s + g.PTS, 0);
  const totalFg3m = last10.reduce((s, g) => s + g.FG3M, 0);
  const gp = last10.length;

  // Estimate FGA from PTS and FG3M (approximate: PTS ~ FGM*2 + FG3M + FTM)
  const avgPts = totalPts / gp;
  const avgFg3m = totalFg3m / gp;

  // Estimate shot distribution from available box-score patterns
  // FG3M relative to points indicates perimeter orientation
  const estimatedFga = avgPts / 1.08; // ~1.08 PTS per FGA league average
  const threePointRate = estimatedFga > 0 ? Math.min((avgFg3m * 2.8) / estimatedFga, 0.60) : 0.35;

  // Free throw rate estimated from player's scoring profile
  const freeThrowRate = Math.min(Math.max(0.15, (avgPts - avgFg3m * 3) / (estimatedFga * 3)), 0.45);

  // Rim rate estimation (correlated with FTR and non-3PT scoring)
  const twoPointRate = 1 - threePointRate;
  const estimatedRimRate = Math.min(0.60, freeThrowRate * 0.8 + Math.max(0, twoPointRate - 0.55) * 0.5);
  const midrangeRate = Math.max(0, twoPointRate - estimatedRimRate);

  // Expected eFG% from shot distribution
  const expectedEfg =
    estimatedRimRate * SHOT_TYPE_EFG.rim +
    midrangeRate * 0.5 * SHOT_TYPE_EFG.short_mid +
    midrangeRate * 0.5 * SHOT_TYPE_EFG.long_mid +
    threePointRate * SHOT_TYPE_EFG.three;

  // Actual eFG% estimated from PTS and FG3M
  const estimatedFgm = (avgPts - avgFg3m) / 2 + avgFg3m; // rough: 2pt FGM + 3pt FGM
  const actualEfg = estimatedFga > 0
    ? Math.min((estimatedFgm + 0.5 * avgFg3m) / estimatedFga, 0.75)
    : 0.50;

  // Shot quality delta
  const delta = actualEfg - expectedEfg;

  // Regression signal
  let regressionSignal: "OVER" | "UNDER" | "NEUTRAL" = "NEUTRAL";
  let regressionMagnitude = 0;
  if (delta > 0.03) {
    regressionSignal = "UNDER"; // Overperforming -> expect regression down
    regressionMagnitude = Math.min(delta / 0.10, 1.0);
  } else if (delta < -0.03) {
    regressionSignal = "OVER"; // Underperforming -> expect regression up
    regressionMagnitude = Math.min(Math.abs(delta) / 0.10, 1.0);
  }

  // Shot quality mix score (rim + 3PT is efficient, midrange is not)
  const shotQualityMix = estimatedRimRate * 1.0 + threePointRate * 0.9 + midrangeRate * 0.5 + freeThrowRate * 0.8;

  // qSQ composite score
  const qsq = Math.min(1, Math.max(0, (actualEfg * 0.4 + shotQualityMix * 0.3 + (1 - midrangeRate) * 0.3)));

  // Archetype classification
  let archetype = "balanced";
  if (estimatedRimRate > 0.40) archetype = "rim_runner";
  else if (threePointRate > 0.38) archetype = "perimeter";
  else if (freeThrowRate > 0.28) archetype = "slasher";
  else if (midrangeRate > 0.25) archetype = "midrange";

  return {
    qsq: round(qsq, 3),
    expectedEfg: round(expectedEfg, 3),
    actualEfg: round(actualEfg, 3),
    shotQualityDelta: round(delta, 3),
    regressionSignal,
    regressionMagnitude: round(regressionMagnitude, 2),
    threePointRate: round(threePointRate, 3),
    freeThrowRate: round(freeThrowRate, 3),
    rimRate: round(estimatedRimRate, 3),
    midrangeRate: round(midrangeRate, 3),
    shotQualityMix: round(shotQualityMix, 3),
    archetype,
  };
}

/**
 * Compute defensive matchup metrics for the player's next game.
 */
function computeDefensiveMatchup(player: Player): DefensiveMatchup {
  const opponent = player.next_opponent || "";
  const scheme = TEAM_SCHEMES[opponent] || "unknown";

  const aggression = SCHEME_AGGRESSION[scheme] ?? 50;
  const variance = SCHEME_VARIANCE[scheme] ?? 50;
  const impacts = SCHEME_IMPACTS[scheme] || {};

  // Opponent defensive rating estimation from vs_team data
  let oppDefRating = 112.0; // league avg
  let oppDefRank = 15;

  // Estimate from vs_team matchup history
  const vsData = player.vs_team?.[opponent];
  if (vsData && vsData.games >= 2) {
    const vsAvgPts = vsData.PTS;
    const seasonAvgPts = player.season_averages.PTS;
    // If player scores more vs this team, weaker defense
    if (seasonAvgPts > 0) {
      const ratio = vsAvgPts / seasonAvgPts;
      oppDefRating = 112.0 * ratio;
    }
  }

  // Rank estimation (1=best, 30=worst defense)
  if (oppDefRating < 108) oppDefRank = Math.round(1 + (oppDefRating - 104) * 2);
  else if (oppDefRating > 116) oppDefRank = Math.round(25 + (oppDefRating - 116) * 1.5);
  else oppDefRank = Math.round(5 + (oppDefRating - 108) * 2.5);
  oppDefRank = Math.max(1, Math.min(30, oppDefRank));

  // Position defense (how well opponent guards this position)
  const position = player.position || "G";
  let positionDefense = 0.5;
  if (position.includes("G")) {
    positionDefense = scheme === "blitz" || scheme === "switch" ? 0.7 : 0.4;
  } else if (position.includes("C")) {
    positionDefense = scheme === "drop" ? 0.7 : 0.4;
  } else {
    positionDefense = scheme === "switch" ? 0.6 : 0.5;
  }

  // Matchup difficulty composite
  const defScore = Math.max(0, Math.min(1, (120 - oppDefRating) / 16));
  const posScore = 1 - oppDefRank / 30;
  const matchupDifficulty = 0.35 * defScore + 0.25 * posScore + 0.20 * (aggression / 100) + 0.20 * positionDefense;

  // Pace adjustment factor
  const teamPace = player.team_pace || 100;
  const oppPace = 100; // default
  const paceAdjFactor = ((teamPace + oppPace) / 2) / 100;

  return {
    aggressionPlus: round(aggression, 1),
    variancePlus: round(variance, 1),
    matchupDifficulty: round(matchupDifficulty, 3),
    schemeName: scheme,
    schemeImpact: impacts,
    oppDefRating: round(oppDefRating, 1),
    oppDefRank,
    positionDefense: round(positionDefense, 2),
    paceAdjFactor: round(paceAdjFactor, 3),
  };
}

/**
 * Compute synergy and lineup features.
 */
function computeSynergyLineup(player: Player): SynergyLineup {
  const games = player.game_logs || player.recent_games;
  const opponent = player.next_opponent || "";

  // Minutes projection from game logs
  let projectedMinutes = player.season_averages.MIN || 25;
  let minutesFloor = projectedMinutes * 0.65;
  let minutesCeiling = Math.min(projectedMinutes * 1.25, 42);
  let minutesStability = 0.5;

  if (games && games.length >= 5) {
    const recentMin = games.slice(0, 10).map(g => g.MIN).filter(m => m > 0);
    if (recentMin.length >= 5) {
      const avg = recentMin.reduce((s, m) => s + m, 0) / recentMin.length;
      const std = Math.sqrt(recentMin.reduce((s, m) => s + Math.pow(m - avg, 2), 0) / recentMin.length);
      const cv = avg > 0 ? std / avg : 1;

      projectedMinutes = round(avg, 1);
      minutesStability = round(Math.max(0, Math.min(1, 1 - cv / 0.3)), 2);
      minutesFloor = round(Math.min(...recentMin), 1);
      minutesCeiling = round(Math.max(...recentMin), 1);
    }
  }

  // Role score
  let roleScore = 0.5;
  if (projectedMinutes >= 32) roleScore = 1.0;
  else if (projectedMinutes >= 26) roleScore = 0.75;
  else if (projectedMinutes >= 20) roleScore = 0.50;
  else if (projectedMinutes >= 14) roleScore = 0.25;
  else roleScore = 0.10;

  // Blowout risk from variance in minutes
  let blowoutRisk = 0.1;
  if (games && games.length >= 5) {
    const minValues = games.slice(0, 5).map(g => g.MIN);
    const minRange = Math.max(...minValues) - Math.min(...minValues);
    blowoutRisk = round(Math.min(minRange / 30, 0.55), 2);
  }

  // Teammates out (from on_off_splits)
  const teammatesOut: { name: string; statImpact: number; minutesImpact: number }[] = [];
  if (player.on_off_splits) {
    for (const split of player.on_off_splits) {
      if (split.impact > 3 && split.sample_size >= 5) {
        const existing = teammatesOut.find(t => t.name === split.without_player);
        if (!existing) {
          teammatesOut.push({
            name: split.without_player,
            statImpact: round(split.impact, 1),
            minutesImpact: round(split.impact * 0.3, 1),
          });
        }
      }
    }
  }

  // Best lineup partners estimated from game performance variance
  const bestLineupPartners: { name: string; netRatingWith: number }[] = [];

  // Lineup impact (estimated from on/off splits)
  let lineupImpact = 0;
  if (player.on_off_splits && player.on_off_splits.length > 0) {
    const avgImpact = player.on_off_splits.reduce((s, split) => s + split.impact, 0) / player.on_off_splits.length;
    lineupImpact = round(avgImpact, 1);
  }

  // Opponent cluster
  const opponentCluster = OPPONENT_CLUSTERS[opponent] || "neutral";

  return {
    lineupImpact,
    minutesStability,
    projectedMinutes,
    minutesFloor,
    minutesCeiling,
    blowoutRisk,
    roleScore,
    teammatesOut,
    bestLineupPartners,
    opponentCluster,
  };
}

/**
 * Get complete tracking stats for a player.
 */
export function computeTrackingStats(player: Player): TrackingStats {
  return {
    playerId: player.player_id,
    playerName: player.player_name,
    shotQuality: computeShotQuality(player),
    defensiveMatchup: computeDefensiveMatchup(player),
    synergyLineup: computeSynergyLineup(player),
    lastUpdated: new Date().toISOString(),
  };
}

// ---- Helpers ----

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function defaultShotQuality(): ShotQuality {
  return {
    qsq: 0.5,
    expectedEfg: 0.50,
    actualEfg: 0.50,
    shotQualityDelta: 0,
    regressionSignal: "NEUTRAL",
    regressionMagnitude: 0,
    threePointRate: 0.35,
    freeThrowRate: 0.25,
    rimRate: 0.30,
    midrangeRate: 0.20,
    shotQualityMix: 0.70,
    archetype: "balanced",
  };
}
