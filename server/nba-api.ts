import type { InsertPlayer } from "@shared/schema";
import { fetchAllTeams, fetchTeamRoster, fetchPlayerGamelog, type ESPNTeam, type ESPNAthlete, type PlayerGameStats } from "./espn-api";
import { calculateHitRatesFromGameLogs, calculateHomAwaySplits } from "./utils/statistics";

interface PlayerStats {
  PTS: number;
  REB: number;
  AST: number;
  FG3M: number;
  PRA: number;
  MIN: number;
  STL?: number;
  BLK?: number;
  TOV?: number;
}

interface PlayerRealStats {
  seasonAverages: PlayerStats;
  gamesPlayed: number;
  recentGames: any[];
  last10Averages: PlayerStats;
  last5Averages: PlayerStats;
  vsTeamStats?: Record<string, { games: number; PTS: number; REB: number; AST: number; FG3M: number; PRA: number }>;
}

export async function buildPlayerFromESPN(athlete: ESPNAthlete, team: ESPNTeam): Promise<InsertPlayer | null> {
  const positionName = athlete.position?.name || 'Guard';

  const parseMin = (minStr: string) => {
    if (!minStr) return 0;
    const parts = minStr.split(':');
    return parseInt(parts[0]) + (parts[1] ? parseInt(parts[1]) / 60 : 0);
  };

  // Try to fetch real gamelog data from ESPN
  let realStats: PlayerRealStats | null = null;
  let gamelog: PlayerGameStats[] = [];

  try {
    gamelog = await fetchPlayerGamelog(athlete.id);

    if (gamelog.length > 0) {
      // Calculate real stats from gamelog

      const calc = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;

      const allPTS = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.PTS || '0'));
      const allREB = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.REB || '0'));
      const allAST = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.AST || '0'));
      const allFG3M = gamelog.map((g: PlayerGameStats) => parseInt(g.stats['3PM'] || g.stats.FG3M || '0'));
      const allMIN = gamelog.map((g: PlayerGameStats) => parseMin(g.stats.MIN || '0'));
      const allSTL = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.STL || '0'));
      const allBLK = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.BLK || '0'));
      const allTOV = gamelog.map((g: PlayerGameStats) => parseInt(g.stats.TO || g.stats.TOV || '0'));


      const seasonAverages = {
        PTS: calc(allPTS),
        REB: calc(allREB),
        AST: calc(allAST),
        FG3M: calc(allFG3M),
        PRA: calc(allPTS) + calc(allREB) + calc(allAST),
        MIN: calc(allMIN),
        STL: calc(allSTL),
        BLK: calc(allBLK),
        TOV: calc(allTOV),
      };

      const l10 = gamelog.slice(0, 10);
      const last10Averages = {
        PTS: calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.PTS || '0'))),
        REB: calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.REB || '0'))),
        AST: calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.AST || '0'))),
        FG3M: calc(l10.map((g: PlayerGameStats) => parseInt(g.stats['3PM'] || g.stats.FG3M || '0'))),
        PRA: calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.PTS || '0'))) + calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.REB || '0'))) + calc(l10.map((g: PlayerGameStats) => parseInt(g.stats.AST || '0'))),
        MIN: calc(l10.map((g: PlayerGameStats) => parseMin(g.stats.MIN || '0'))),
      };

      const l5 = gamelog.slice(0, 5);
      const last5Averages = {
        PTS: calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.PTS || '0'))),
        REB: calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.REB || '0'))),
        AST: calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.AST || '0'))),
        FG3M: calc(l5.map((g: PlayerGameStats) => parseInt(g.stats['3PM'] || g.stats.FG3M || '0'))),
        PRA: calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.PTS || '0'))) + calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.REB || '0'))) + calc(l5.map((g: PlayerGameStats) => parseInt(g.stats.AST || '0'))),
        MIN: calc(l5.map((g: PlayerGameStats) => parseMin(g.stats.MIN || '0'))),
      };

      const recentGames = gamelog.slice(0, 5).map((g: PlayerGameStats) => ({
        WL: g.game.result?.charAt(0) || '?',
        PTS: parseInt(g.stats.PTS || '0'),
        REB: parseInt(g.stats.REB || '0'),
        AST: parseInt(g.stats.AST || '0'),
        FG3M: parseInt(g.stats['3PM'] || g.stats.FG3M || '0'),
        MIN: Math.round(parseMin(g.stats.MIN || '0')),
        OPPONENT: g.game.opponent?.abbreviation || '?',
        GAME_DATE: g.game.date ? new Date(g.game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '',
      }));

      // Calculate vs_team stats from gamelog
      const vsTeamMap = new Map<string, { pts: number[]; reb: number[]; ast: number[]; fg3m: number[] }>();
      for (const g of gamelog) {
        const opp = g.game.opponent?.abbreviation;
        if (!opp) continue;
        if (!vsTeamMap.has(opp)) {
          vsTeamMap.set(opp, { pts: [], reb: [], ast: [], fg3m: [] });
        }
        const data = vsTeamMap.get(opp)!;
        data.pts.push(parseInt(g.stats.PTS || '0'));
        data.reb.push(parseInt(g.stats.REB || '0'));
        data.ast.push(parseInt(g.stats.AST || '0'));
        data.fg3m.push(parseInt(g.stats['3PM'] || g.stats.FG3M || '0'));
      }

      const vsTeamStats: Record<string, { games: number; PTS: number; REB: number; AST: number; FG3M: number; PRA: number }> = {};
      for (const [team, data] of Array.from(vsTeamMap)) {
        const avg = (arr: number[]) => arr.length > 0 ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;
        const pts = avg(data.pts);
        const reb = avg(data.reb);
        const ast = avg(data.ast);
        vsTeamStats[team] = {
          games: data.pts.length,
          PTS: pts,
          REB: reb,
          AST: ast,
          FG3M: avg(data.fg3m),
          PRA: Math.round((pts + reb + ast) * 10) / 10,
        };
      }

      realStats = { seasonAverages, gamesPlayed: gamelog.length, recentGames, last10Averages, last5Averages, vsTeamStats };
    }
  } catch (e) {
    console.warn(`Failed to fetch gamelog for ${athlete.displayName}, skipping player`);
  }

  // Skip players without real stats — never use fabricated data
  if (!realStats) {
    return null;
  }

  const { seasonAverages, gamesPlayed } = realStats;
  const last10Averages = realStats.last10Averages;
  const last5Averages = realStats.last5Averages;
  const recentGames = realStats.recentGames;

  // Build full game logs with home/away data for real calculations
  const fullGameLogs = realStats ? gamelog.map((g: PlayerGameStats) => ({
    GAME_DATE: g.game.date ? new Date(g.game.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() : '',
    OPPONENT: g.game.opponent?.abbreviation || '?',
    PTS: parseInt(g.stats.PTS || '0'),
    REB: parseInt(g.stats.REB || '0'),
    AST: parseInt(g.stats.AST || '0'),
    FG3M: parseInt(g.stats['3PM'] || g.stats.FG3M || '0'),
    STL: parseInt(g.stats.STL || '0'),
    BLK: parseInt(g.stats.BLK || '0'),
    TOV: parseInt(g.stats.TO || g.stats.TOV || '0'),
    WL: g.game.result?.charAt(0) || '?',
    MIN: Math.round(parseMin(g.stats.MIN || '0')),
    IS_HOME: g.game.isHome ?? undefined,
  })) : [];

  // Calculate REAL hit rates from actual game logs (not mock formulas)
  const hitRates: Record<string, any> = {};
  const statTypes = ['PTS', 'REB', 'AST', 'FG3M', 'PRA'];

  if (fullGameLogs.length >= 10) {
    for (const statType of statTypes) {
      const avg = seasonAverages[statType as keyof typeof seasonAverages] as number;
      if (typeof avg === 'number' && avg > 0) {
        const rates = calculateHitRatesFromGameLogs(fullGameLogs, statType, avg);
        if (Object.keys(rates).length > 0) {
          hitRates[statType] = rates;
        }
      }
    }
  }

  // Stat types without enough game data simply won't have hit rates
  // — no fabricated rates are generated

  // Calculate REAL home/away splits from game logs (not fixed multipliers)
  const realSplits = fullGameLogs.length >= 16
    ? calculateHomAwaySplits(fullGameLogs)
    : null;

  // Use real splits when available, otherwise use season averages as neutral default
  const homeAvgs = realSplits?.home || {
    PTS: seasonAverages.PTS,
    REB: seasonAverages.REB,
    AST: seasonAverages.AST,
    PRA: seasonAverages.PRA,
  };
  const awayAvgs = realSplits?.away || {
    PTS: seasonAverages.PTS,
    REB: seasonAverages.REB,
    AST: seasonAverages.AST,
    PRA: seasonAverages.PRA,
  };

  return {
    player_id: parseInt(athlete.id),
    player_name: athlete.displayName,
    team: team.abbreviation,
    team_id: parseInt(team.id),
    games_played: gamesPlayed,
    season_averages: seasonAverages,
    last_10_averages: last10Averages,
    last_5_averages: last5Averages,
    hit_rates: hitRates,
    vs_team: realStats?.vsTeamStats || {},
    recent_games: recentGames,
    home_averages: homeAvgs,
    away_averages: awayAvgs,
    game_logs: fullGameLogs.length > 0 ? fullGameLogs : undefined,
  };
}

export async function fetchAndBuildAllPlayers(
  progressCallback?: (current: number, total: number) => void
): Promise<InsertPlayer[]> {
  console.log("Fetching all NBA teams from ESPN...");
  const teams = await fetchAllTeams();
  console.log(`Found ${teams.length} teams.`);

  const allPlayers: InsertPlayer[] = [];
  let processedCount = 0;

  // Total (rough estimate) for progress bar
  const estimatedTotal = teams.length * 15;

  for (const team of teams) {
    console.log(`Fetching roster for ${team.displayName}...`);
    const roster = await fetchTeamRoster(team.id);

    for (const athlete of roster) {
      const playerData = await buildPlayerFromESPN(athlete, team);
      if (playerData) {
        allPlayers.push(playerData);
      }
      processedCount++;
      if (processedCount % 10 === 0) {
        progressCallback?.(processedCount, estimatedTotal);
      }
    }
  }

  console.log(`Built data for ${allPlayers.length} players`);
  return allPlayers;
}

