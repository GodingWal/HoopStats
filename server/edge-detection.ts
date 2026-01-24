import type { Player } from "@shared/schema";
import { injuryWatcher } from "./injury-watcher";

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
 * Analyze a player/bet for betting edges
 */
export function analyzeEdges(
  player: Player,
  statType: string,
  recommendation: "OVER" | "UNDER",
  hitRate: number
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

  // TIER 3 EDGES (Situational)

  // 7. Home/road splits - Some players have dramatic splits
  const homeRoadEdge = detectHomeRoadSplitEdge(player, statType, recommendation);
  if (homeRoadEdge) edges.push(homeRoadEdge);

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
  // Check if this player has a significant on/off split showing they benefit from a star being out
  const onOffSplits = player.on_off_splits;
  if (!onOffSplits || onOffSplits.length === 0) return null;

  // Get currently injured players from the team
  const teamOutPlayers = injuryWatcher.getTeamOutPlayers(player.team);

  // Find the biggest beneficiary relationship where the star is actually OUT
  // on_off_splits format: [{ without_player: "LeBron James", with_pct: 15.2, without_pct: 25.8, impact: 10.6, stat: "pts" }]
  for (const split of onOffSplits) {
    if (split.stat === statType.toLowerCase() && split.impact > 5.0) {
      // Check if this star player is actually OUT today
      const starIsOut = teamOutPlayers.some(injury =>
        injury.playerName.toLowerCase().includes(split.without_player.toLowerCase()) ||
        split.without_player.toLowerCase().includes(injury.playerName.toLowerCase())
      );

      if (starIsOut) {
        // CONFIRMED: Star is out and this player historically benefits
        return {
          type: "STAR_OUT",
          score: 10, // Tier 1, highest score - THE BEST EDGE
          description: `${split.without_player} OUT: ${player.player_name} averages +${split.impact.toFixed(1)} ${statType.toUpperCase()} without them`,
          tier: 1,
        };
      } else {
        // Star is not injured - check if there's potential value anyway
        // This could still be useful if the split is very significant (7.0+)
        if (split.impact > 7.0) {
          return {
            type: "STAR_OUT_POTENTIAL",
            score: 6, // Lower tier edge - star not currently out but watch for it
            description: `Monitor: ${player.player_name} gains +${split.impact.toFixed(1)} ${statType.toUpperCase()} when ${split.without_player} sits`,
            tier: 2,
          };
        }
      }
    }
  }

  return null;
}

function detectBackToBackEdge(player: Player, recommendation: "OVER" | "UNDER"): Edge | null {
  // Check if player is on second night of back-to-back
  // This would require game schedule data - for now, check if last game was yesterday
  const gameLogs = player.game_logs;
  if (!gameLogs || gameLogs.length < 2) return null;

  const lastGame = gameLogs[0];
  const secondLastGame = gameLogs[1];

  if (!lastGame?.date || !secondLastGame?.date) return null;

  const lastDate = new Date(lastGame.date);
  const secondLastDate = new Date(secondLastGame.date);
  const daysDiff = (lastDate.getTime() - secondLastDate.getTime()) / (1000 * 60 * 60 * 24);

  // If last two games were within 1-2 days and recommending UNDER
  if (daysDiff <= 2 && recommendation === "UNDER") {
    return {
      type: "BACK_TO_BACK",
      score: 9, // Tier 1
      description: `Back-to-back game: Fatigue factor in play`,
      tier: 1,
    };
  }

  return null;
}

function detectBlowoutRiskEdge(player: Player, recommendation: "OVER" | "UNDER"): Edge | null {
  // Check if matchup has high blowout potential based on team quality diff
  // This requires opponent data and team ratings
  // For now, we can check if player's team has inconsistent results (high variance)
  const gameLogs = player.game_logs;
  if (!gameLogs || gameLogs.length < 5) return null;

  // Check if player's minutes varied significantly in recent games (blowout indicator)
  const recentMinutes = gameLogs.slice(0, 5).map(g => g.min).filter((m): m is number => m !== null);
  if (recentMinutes.length < 5) return null;

  const avgMinutes = recentMinutes.reduce((sum, m) => sum + m, 0) / recentMinutes.length;
  const variance = recentMinutes.reduce((sum, m) => sum + Math.pow(m - avgMinutes, 2), 0) / recentMinutes.length;
  const stdDev = Math.sqrt(variance);

  // High variance in minutes suggests blowout risk
  if (stdDev > 5 && recommendation === "UNDER") {
    return {
      type: "BLOWOUT_RISK",
      score: 8, // Tier 1
      description: `Blowout risk: Inconsistent minutes (±${stdDev.toFixed(1)} min variance)`,
      tier: 1,
    };
  }

  return null;
}

function detectPaceEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  // Check if player's team or opponent plays at fast pace
  // Fast pace = more possessions = more counting stats
  const pace = player.team_pace;
  if (!pace) return null;

  // NBA average pace is around 99-100
  const fastPaceThreshold = 102;
  const slowPaceThreshold = 97;

  if (pace >= fastPaceThreshold && recommendation === "OVER" && (statType === "PTS" || statType === "AST" || statType === "PRA")) {
    return {
      type: "PACE_MATCHUP",
      score: 7, // Tier 2
      description: `Fast pace (${pace.toFixed(1)}): More possessions = more ${statType}`,
      tier: 2,
    };
  }

  if (pace <= slowPaceThreshold && recommendation === "UNDER" && (statType === "PTS" || statType === "AST" || statType === "PRA")) {
    return {
      type: "PACE_MATCHUP",
      score: 6, // Tier 2
      description: `Slow pace (${pace.toFixed(1)}): Fewer possessions limit ${statType}`,
      tier: 2,
    };
  }

  return null;
}

function detectDefensiveEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  // Check if upcoming opponent is weak defensively against this stat type
  // This requires team defense ratings vs position
  const vsTeamStats = player.vs_team_stats;
  if (!vsTeamStats || Object.keys(vsTeamStats).length === 0) return null;

  // Find teams where player performs significantly better
  for (const [team, stats] of Object.entries(vsTeamStats)) {
    const relevantStat = stats[statType as keyof typeof stats];
    if (typeof relevantStat === 'number' && relevantStat > player.season_averages[statType as keyof typeof player.season_averages] * 1.15) {
      // Player averages 15%+ more against this team
      if (recommendation === "OVER") {
        return {
          type: "BAD_DEFENSE",
          score: 7, // Tier 2
          description: `vs ${team}: Averages ${relevantStat.toFixed(1)} ${statType} (season: ${player.season_averages[statType as keyof typeof player.season_averages]})`,
          tier: 2,
        };
      }
    }
  }

  return null;
}

function detectMinutesStabilityEdge(player: Player): Edge | null {
  // Check if player has consistent minutes (34+ locked in)
  const gameLogs = player.game_logs;
  if (!gameLogs || gameLogs.length < 10) return null;

  const recentMinutes = gameLogs.slice(0, 10).map(g => g.min).filter((m): m is number => m !== null);
  if (recentMinutes.length < 8) return null;

  const avgMinutes = recentMinutes.reduce((sum, m) => sum + m, 0) / recentMinutes.length;
  const minMinutes = Math.min(...recentMinutes);

  // Consistent 34+ minutes = predictable output
  if (avgMinutes >= 34 && minMinutes >= 30) {
    return {
      type: "MINUTES_STABILITY",
      score: 6, // Tier 2
      description: `Locked into ${avgMinutes.toFixed(1)} MPG (consistent role)`,
      tier: 2,
    };
  }

  return null;
}

function detectHomeRoadSplitEdge(player: Player, statType: string, recommendation: "OVER" | "UNDER"): Edge | null {
  // Check for dramatic home/road splits
  const homeSplits = player.home_splits;
  const awaySplits = player.away_splits;

  if (!homeSplits || !awaySplits) return null;

  const homeStat = homeSplits[statType as keyof typeof homeSplits];
  const awayStat = awaySplits[statType as keyof typeof awaySplits];

  if (typeof homeStat !== 'number' || typeof awayStat !== 'number') return null;

  const diff = Math.abs(homeStat - awayStat);
  const avgStat = (homeStat + awayStat) / 2;
  const splitPercentage = (diff / avgStat) * 100;

  // Significant split (20%+ difference)
  if (splitPercentage >= 20) {
    const betterLocation = homeStat > awayStat ? "home" : "away";
    const splitDirection = homeStat > awayStat ? "higher at home" : "better on road";

    // We don't know current game location without additional data
    // For now, just note the split exists
    return {
      type: "HOME_ROAD_SPLIT",
      score: 5, // Tier 3
      description: `${splitDirection}: ${Math.max(homeStat, awayStat).toFixed(1)} vs ${Math.min(homeStat, awayStat).toFixed(1)} ${statType}`,
      tier: 3,
    };
  }

  return null;
}
