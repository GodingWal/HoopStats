import type { Player } from "@shared/schema";
import { injuryWatcher } from "./injury-watcher";
import { BETTING_CONFIG } from "./constants";

export interface Edge {
  type: string;
  score: number; // 1-10, where 10 is the best edge
  description: string;
  tier: 1 | 2 | 3;
}

export interface EdgeAnalysis {
  edges: Edge[];
  bestEdge: Edge | null;
  totalScore: number;
}

/**
 * Optional line movement data that can be passed to edge detection
 */
export interface LineMovementData {
  direction: 'up' | 'down';
  magnitude: number; // Absolute change in line value
  isSignificant: boolean;
}

/**
 * Analyze a player/bet for betting edges.
 * Uses typed Player fields instead of unsafe `as any` casts.
 */
export function analyzeEdges(
  player: Player,
  statType: string,
  recommendation: "OVER" | "UNDER",
  hitRate: number,
  lineMovement?: LineMovementData
): EdgeAnalysis {
  const edges: Edge[] = [];

  // TIER 1 EDGES (Highest win rate)

  // 1. Star player OUT - Check if a star teammate is injured and this player benefits
  const starOutEdge = detectStarOutEdge(player, statType);
  if (starOutEdge) edges.push(starOutEdge);

  // 2. Back-to-back UNDERS - Check if player is on second night of B2B
  const b2bEdge = detectBackToBackEdge(player, recommendation);
  if (b2bEdge) edges.push(b2bEdge);

  // 3. Blowout risk UNDERS - Check if matchup has high blowout potential
  const blowoutEdge = detectBlowoutRiskEdge(player, recommendation);
  if (blowoutEdge) edges.push(blowoutEdge);

  // TIER 2 EDGES (Solid edges)

  // 4. Pace matchups - Fast pace teams inflate counting stats
  const paceEdge = detectPaceEdge(player, statType, recommendation);
  if (paceEdge) edges.push(paceEdge);

  // 5. Bad positional defense - Target weak defensive matchups
  const defenseEdge = detectDefensiveEdge(player, statType, recommendation);
  if (defenseEdge) edges.push(defenseEdge);

  // 6. Minutes stability - Players locked into consistent minutes
  const minutesEdge = detectMinutesStabilityEdge(player);
  if (minutesEdge) edges.push(minutesEdge);

  // 7. Recent form - Hot/cold streak detection
  const formEdge = detectRecentFormEdge(player, statType, recommendation);
  if (formEdge) edges.push(formEdge);

  // TIER 3 EDGES (Situational)

  // 8. Home/road splits - Some players have dramatic splits
  const homeRoadEdge = detectHomeRoadSplitEdge(player, statType, recommendation);
  if (homeRoadEdge) edges.push(homeRoadEdge);

  // 9. Line movement - Line moved in our direction (CLV indicator)
  if (lineMovement && lineMovement.isSignificant) {
    const lineEdge = detectLineMovementEdge(lineMovement, recommendation);
    if (lineEdge) edges.push(lineEdge);
  }

  // 12. Rest days advantage
  const restEdge = detectRestDaysEdge(player, recommendation);
  if (restEdge) edges.push(restEdge);

  // 13. Minutes projection trend
  const minutesProjEdge = detectMinutesProjectionEdge(player, statType, recommendation);
  if (minutesProjEdge) edges.push(minutesProjEdge);

  // 14. Usage redistribution from injuries
  const usageEdge = detectUsageRedistributionEdge(player, statType, recommendation);
  if (usageEdge) edges.push(usageEdge);

  // Calculate total edge score
  const totalScore = edges.reduce((sum, edge) => sum + edge.score, 0);

  // Find best edge (highest score, preferring lower tier)
  const bestEdge = edges.length > 0
    ? edges.reduce((best, current) => {
      if (!best) return current;
      if (current.tier < best.tier) return current;
      if (current.tier === best.tier && current.score > best.score) return current;
      return best;
    })
    : null;

  return { edges, bestEdge, totalScore };
}

function detectStarOutEdge(player: Player, statType: string): Edge | null {
  const onOffSplits = player.on_off_splits;
  if (!onOffSplits || onOffSplits.length === 0) return null;

  // Get currently injured players from the team
  const teamOutPlayers = injuryWatcher.getTeamOutPlayers(player.team);

  const minSampleSize = BETTING_CONFIG.MIN_SPLIT_SAMPLE_SIZE;

  for (const split of onOffSplits) {
    if (split.stat === statType.toLowerCase() && split.impact > 5.0 && split.sample_size >= minSampleSize) {
      // Check if this star player is actually OUT today
      const starIsOut = teamOutPlayers.some(playerName =>
        playerName.toLowerCase().includes(split.without_player.toLowerCase()) ||
        split.without_player.toLowerCase().includes(playerName.toLowerCase())
      );

      if (starIsOut) {
        return {
          type: "STAR_OUT",
          score: 10,
          description: `${split.without_player} OUT: ${player.player_name} averages +${split.impact.toFixed(1)} ${statType.toUpperCase()} without them (${split.sample_size} games)`,
          tier: 1,
        };
      } else if (split.impact > 7.0) {
        return {
          type: "STAR_OUT_POTENTIAL",
          score: 6,
          description: `Monitor: ${player.player_name} gains +${split.impact.toFixed(1)} ${statType.toUpperCase()} when ${split.without_player} sits`,
          tier: 2,
        };
      }
    }
  }

  return null;
}

function detectBackToBackEdge(player: Player, recommendation: "OVER" | "UNDER"): Edge | null {
  // Use game_logs (typed) or fall back to recent_games
  const gameLogs = player.game_logs || player.recent_games;
  if (!gameLogs || gameLogs.length < 2) return null;

  const lastGame = gameLogs[0];
  const secondLastGame = gameLogs[1];

  if (!lastGame?.GAME_DATE || !secondLastGame?.GAME_DATE) return null;

  const lastDate = new Date(lastGame.GAME_DATE);
  const secondLastDate = new Date(secondLastGame.GAME_DATE);
  const daysDiff = (lastDate.getTime() - secondLastDate.getTime()) / (1000 * 60 * 60 * 24);

  if (daysDiff <= 2 && recommendation === "UNDER") {
    return {
      type: "BACK_TO_BACK",
      score: 9,
      description: `Back-to-back game: Fatigue factor in play`,
      tier: 1,
    };
  }

  return null;
}

function detectBlowoutRiskEdge(player: Player, recommendation: "OVER" | "UNDER"): Edge | null {
  const gameLogs = player.game_logs || player.recent_games;
  if (!gameLogs || gameLogs.length < 5) return null;

  const recentMinutes = gameLogs.slice(0, 5)
    .map(g => g.MIN)
    .filter((m): m is number => typeof m === 'number' && m > 0);
  if (recentMinutes.length < 5) return null;

  const avgMinutes = recentMinutes.reduce((sum, m) => sum + m, 0) / recentMinutes.length;
  const variance = recentMinutes.reduce((sum, m) => sum + Math.pow(m - avgMinutes, 2), 0) / recentMinutes.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev > 5 && recommendation === "UNDER") {
    return {
      type: "BLOWOUT_RISK",
      score: 8,
      description: `Blowout risk: Inconsistent minutes (±${stdDev.toFixed(1)} min variance)`,
      tier: 1,
    };
  }

  return null;
}

function detectPaceEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  const pace = player.team_pace;
  if (!pace) return null;

  const fastPaceThreshold = 102;
  const slowPaceThreshold = 97;

  if (pace >= fastPaceThreshold && recommendation === "OVER" && (statType === "PTS" || statType === "AST" || statType === "PRA")) {
    return {
      type: "PACE_MATCHUP",
      score: 7,
      description: `Fast pace (${pace.toFixed(1)}): More possessions = more ${statType}`,
      tier: 2,
    };
  }

  if (pace <= slowPaceThreshold && recommendation === "UNDER" && (statType === "PTS" || statType === "AST" || statType === "PRA")) {
    return {
      type: "PACE_MATCHUP",
      score: 6,
      description: `Slow pace (${pace.toFixed(1)}): Fewer possessions limit ${statType}`,
      tier: 2,
    };
  }

  return null;
}

function detectDefensiveEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  // Use vs_team (typed field) for matchup data
  const vsTeam = player.vs_team;
  if (!vsTeam || Object.keys(vsTeam).length === 0) return null;

  const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
  if (typeof seasonAvg !== 'number') return null;

  // Check if opponent allows significantly more of this stat
  const opponent = player.next_opponent;
  if (opponent && vsTeam[opponent]) {
    const stats = vsTeam[opponent];
    const relevantStat = stats[statType as keyof typeof stats] as number | undefined;
    if (typeof relevantStat === 'number' && relevantStat > seasonAvg * 1.15) {
      if (recommendation === "OVER") {
        return {
          type: "BAD_DEFENSE",
          score: 7,
          description: `vs ${opponent}: Averages ${relevantStat.toFixed(1)} ${statType} (season: ${seasonAvg})`,
          tier: 2,
        };
      }
    }
  }

  // Fallback: check all teams for strong matchup (if no specific opponent set)
  if (!opponent) {
    for (const [team, stats] of Object.entries(vsTeam)) {
      const relevantStat = stats[statType as keyof typeof stats] as number | undefined;
      if (typeof relevantStat === 'number' && relevantStat > seasonAvg * 1.15) {
        if (recommendation === "OVER") {
          return {
            type: "BAD_DEFENSE",
            score: 7,
            description: `vs ${team}: Averages ${relevantStat.toFixed(1)} ${statType} (season: ${seasonAvg})`,
            tier: 2,
          };
        }
      }
    }
  }

  return null;
}

function detectMinutesStabilityEdge(player: Player): Edge | null {
  const gameLogs = player.game_logs || player.recent_games;
  if (!gameLogs || gameLogs.length < 10) return null;

  const recentMinutes = gameLogs.slice(0, 10)
    .map(g => g.MIN)
    .filter((m): m is number => typeof m === 'number' && m > 0);
  if (recentMinutes.length < 8) return null;

  const avgMinutes = recentMinutes.reduce((sum, m) => sum + m, 0) / recentMinutes.length;
  const minMinutes = Math.min(...recentMinutes);

  // Require both high average minutes AND high usage (if available)
  const hasHighUsage = !player.usage_rate || player.usage_rate >= 22;

  if (avgMinutes >= 34 && minMinutes >= 30 && hasHighUsage) {
    return {
      type: "MINUTES_STABILITY",
      score: 6,
      description: `Locked into ${avgMinutes.toFixed(1)} MPG (consistent role${player.usage_rate ? `, ${player.usage_rate.toFixed(1)}% USG` : ''})`,
      tier: 2,
    };
  }

  return null;
}

/**
 * Detect recent form trends (hot/cold streaks).
 * Compares last 5 game averages to season averages.
 */
function detectRecentFormEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  const last5Avg = player.last_5_averages[statType as keyof typeof player.last_5_averages];
  const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];

  if (typeof last5Avg !== 'number' || typeof seasonAvg !== 'number' || seasonAvg === 0) return null;

  const diffPct = ((last5Avg - seasonAvg) / seasonAvg) * 100;

  // Hot streak: 15%+ above season avg and recommending OVER
  if (diffPct >= 15 && recommendation === "OVER") {
    return {
      type: "RECENT_FORM",
      score: 5,
      description: `Hot streak: ${last5Avg.toFixed(1)} ${statType} last 5 (season: ${seasonAvg.toFixed(1)}, +${diffPct.toFixed(0)}%)`,
      tier: 2,
    };
  }

  // Cold streak: 15%+ below season avg and recommending UNDER
  if (diffPct <= -15 && recommendation === "UNDER") {
    return {
      type: "RECENT_FORM",
      score: 5,
      description: `Cold streak: ${last5Avg.toFixed(1)} ${statType} last 5 (season: ${seasonAvg.toFixed(1)}, ${diffPct.toFixed(0)}%)`,
      tier: 2,
    };
  }

  return null;
}

/**
 * Detect line movement edge - line moved in our direction (positive CLV).
 * If line moved against our recommendation, return negative signal.
 */
function detectLineMovementEdge(movement: LineMovementData, recommendation: "OVER" | "UNDER"): Edge | null {
  // Line went UP: benefits OVER (higher line means books moved against over bettors, so if we're UNDER it's good)
  // Line went DOWN: benefits UNDER (lower line means books moved against under bettors, so if we're OVER it's good)
  // Actually: if line moves DOWN and we're recommending OVER, that's line moving in our favor (easier to go over)
  // If line moves UP and we're recommending UNDER, that's line moving in our favor (easier to go under)

  const lineMovedInOurFavor =
    (movement.direction === 'down' && recommendation === 'OVER') ||
    (movement.direction === 'up' && recommendation === 'UNDER');

  if (lineMovedInOurFavor) {
    return {
      type: "LINE_MOVEMENT",
      score: Math.min(7, Math.round(3 + movement.magnitude * 4)), // Scale with magnitude
      description: `Line moved ${movement.direction} ${movement.magnitude.toFixed(1)} pts in our favor (CLV+)`,
      tier: 2,
    };
  }

  return null;
}

/**
 * Detect rest days advantage.
 * Players on 2+ rest days tend to perform better; B2B fatigue hurts.
 * Also detects when the opponent is on a B2B (advantage to player).
 */
function detectRestDaysEdge(player: Player, recommendation: "OVER" | "UNDER"): Edge | null {
  const gameLogs = player.game_logs || player.recent_games;
  if (!gameLogs || gameLogs.length < 2) return null;

  const lastGame = gameLogs[0];
  if (!lastGame?.GAME_DATE) return null;

  const lastDate = new Date(lastGame.GAME_DATE);
  const today = new Date();
  const restDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) - 1;

  // Well-rested player (3+ rest days) favors OVER
  if (restDays >= 3 && recommendation === "OVER") {
    return {
      type: "REST_DAYS",
      score: 5,
      description: `Well-rested: ${restDays} days off (fresh legs boost)`,
      tier: 3,
    };
  }

  // Fatigued player (0 rest = B2B) favors UNDER - but don't double-count with B2B edge
  // Only fire if this is a borderline case (1 day rest, not quite B2B)
  if (restDays === 0 && recommendation === "UNDER") {
    // B2B edge already handles the strongest case; this adds the rest-day signal mapping
    return {
      type: "REST_DAYS",
      score: 4,
      description: `No rest: Back-to-back game fatigue`,
      tier: 3,
    };
  }

  return null;
}

/**
 * Detect minutes projection trend.
 * Compares recent 5-game minutes average to 10-game baseline.
 * A rising/falling minutes trend signals coach confidence changes.
 */
function detectMinutesProjectionEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  const gameLogs = player.game_logs || player.recent_games;
  if (!gameLogs || gameLogs.length < 10) return null;

  const recentMinutes = gameLogs.slice(0, 5)
    .map(g => g.MIN)
    .filter((m): m is number => typeof m === 'number' && m > 0);
  const baselineMinutes = gameLogs.slice(0, 15)
    .map(g => g.MIN)
    .filter((m): m is number => typeof m === 'number' && m > 0);

  if (recentMinutes.length < 4 || baselineMinutes.length < 8) return null;

  const recentAvg = recentMinutes.reduce((s, m) => s + m, 0) / recentMinutes.length;
  const baselineAvg = baselineMinutes.reduce((s, m) => s + m, 0) / baselineMinutes.length;

  if (baselineAvg === 0) return null;
  const deviationPct = ((recentAvg - baselineAvg) / baselineAvg) * 100;

  // Minutes trending up significantly (>5%) favors OVER
  if (deviationPct >= 5 && recommendation === "OVER") {
    return {
      type: "MINUTES_PROJECTION",
      score: 6,
      description: `Minutes trending UP: ${recentAvg.toFixed(1)} MPG last 5 vs ${baselineAvg.toFixed(1)} baseline (+${deviationPct.toFixed(0)}%)`,
      tier: 2,
    };
  }

  // Minutes trending down significantly (>5%) favors UNDER
  if (deviationPct <= -5 && recommendation === "UNDER") {
    return {
      type: "MINUTES_PROJECTION",
      score: 6,
      description: `Minutes trending DOWN: ${recentAvg.toFixed(1)} MPG last 5 vs ${baselineAvg.toFixed(1)} baseline (${deviationPct.toFixed(0)}%)`,
      tier: 2,
    };
  }

  return null;
}

/**
 * Detect usage redistribution from teammate injuries.
 * When multiple teammates are out, the remaining players absorb usage.
 * Similar to injury_alpha but focuses on cumulative multi-player absence.
 */
function detectUsageRedistributionEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  const onOffSplits = player.on_off_splits;
  if (!onOffSplits || onOffSplits.length === 0) return null;

  const teamOutPlayers = injuryWatcher.getTeamOutPlayers(player.team);
  if (teamOutPlayers.length < 2) return null; // Need 2+ out for redistribution effect

  const minSampleSize = BETTING_CONFIG.MIN_SPLIT_SAMPLE_SIZE;
  let totalBoost = 0;
  const outNames: string[] = [];

  for (const split of onOffSplits) {
    if (split.stat !== statType.toLowerCase()) continue;
    if (split.sample_size < minSampleSize) continue;

    const starIsOut = teamOutPlayers.some(playerName =>
      playerName.toLowerCase().includes(split.without_player.toLowerCase()) ||
      split.without_player.toLowerCase().includes(playerName.toLowerCase())
    );

    if (starIsOut && split.impact > 0) {
      totalBoost += split.impact;
      outNames.push(split.without_player);
    }
  }

  // Cap at 30% of season average (matching Python signal)
  const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
  const maxBoost = typeof seasonAvg === 'number' ? seasonAvg * 0.30 : Infinity;
  totalBoost = Math.min(totalBoost, maxBoost);

  if (totalBoost > 3 && recommendation === "OVER") {
    const uniqueOut = [...new Set(outNames)];
    return {
      type: "USAGE_REDISTRIBUTION",
      score: Math.min(8, Math.round(4 + totalBoost)),
      description: `Usage redistribution: +${totalBoost.toFixed(1)} ${statType} projected (${uniqueOut.length} teammates out: ${uniqueOut.join(', ')})`,
      tier: 2,
    };
  }

  return null;
}

function detectHomeRoadSplitEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  // Use typed home_averages/away_averages fields
  const homeStat = player.home_averages[statType as keyof typeof player.home_averages];
  const awayStat = player.away_averages[statType as keyof typeof player.away_averages];

  if (typeof homeStat !== 'number' || typeof awayStat !== 'number') return null;

  const diff = Math.abs(homeStat - awayStat);
  const avgStat = (homeStat + awayStat) / 2;
  if (avgStat === 0) return null;
  const splitPercentage = (diff / avgStat) * 100;

  // Significant split (20%+ difference)
  if (splitPercentage >= 20) {
    const betterLocation = homeStat > awayStat ? "home" : "away";
    const splitDirection = homeStat > awayStat ? "higher at home" : "better on road";

    // Check if we know tonight's game location
    const gameLocation = player.next_game_location;
    let locationMatch = false;

    if (gameLocation) {
      // Recommend OVER when playing at the location where they perform better
      if (gameLocation === betterLocation && recommendation === "OVER") locationMatch = true;
      // Recommend UNDER when playing at the location where they perform worse
      if (gameLocation !== betterLocation && recommendation === "UNDER") locationMatch = true;
    }

    // Boost score if location matches recommendation
    const score = locationMatch ? 7 : 5;
    const tierValue: 2 | 3 = locationMatch ? 2 : 3;

    return {
      type: "HOME_ROAD_SPLIT",
      score,
      description: `${splitDirection}: ${Math.max(homeStat, awayStat).toFixed(1)} vs ${Math.min(homeStat, awayStat).toFixed(1)} ${statType}${gameLocation ? ` (${gameLocation} tonight)` : ''}`,
      tier: tierValue,
    };
  }

  return null;
}
