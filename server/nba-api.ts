import type { InsertPlayer } from "@shared/schema";
import { fetchAllTeams, fetchTeamRoster, fetchPlayerGamelog, type ESPNTeam, type ESPNAthlete, type PlayerGameStats } from "./espn-api";

// Reusing mock stat generation for now as we don't have a bulk stats endpoint
// and fetching 500+ player gamelogs individually would be too slow/rate-limited.

interface PlayerStats {
  PTS: number;
  REB: number;
  AST: number;
  FG3M: number;
  PRA: number;
  MIN: number;
  STL: number;
  BLK: number;
  TOV: number;
}

interface PlayerRealStats {
  seasonAverages: PlayerStats;
  gamesPlayed: number;
  recentGames: PlayerGameStats[];
  last10Averages: PlayerStats;
  last5Averages: PlayerStats;
  vsTeamStats?: Record<string, { games: number; PTS: number; REB: number; AST: number; FG3M: number; PRA: number }>;
}

function generateMockStats(position: string): {
  seasonAverages: { PTS: number; REB: number; AST: number; FG3M: number; PRA: number; MIN: number; STL: number; BLK: number; TOV: number };
  gamesPlayed: number;
} {
  const isGuard = position.includes('Guard') || position.includes('G');
  const isCenter = position.includes('Center') || position.includes('C');
  const isForward = position.includes('Forward') || position.includes('F');

  const baseMultiplier = 0.7 + Math.random() * 0.6;

  let pts = 8 + Math.random() * 12;
  let reb = isCenter ? 6 + Math.random() * 5 : (isForward ? 4 + Math.random() * 4 : 2 + Math.random() * 3);
  let ast = isGuard ? 3 + Math.random() * 4 : 1 + Math.random() * 2;
  let fg3m = isGuard ? 1 + Math.random() * 2 : 0.5 + Math.random() * 1.5;
  let stl = 0.5 + Math.random() * 1;
  let blk = isCenter ? 0.8 + Math.random() * 1.2 : 0.2 + Math.random() * 0.5;
  let tov = 1 + Math.random() * 2;
  let min = 20 + Math.random() * 15;

  pts *= baseMultiplier;
  reb *= baseMultiplier;
  ast *= baseMultiplier;

  const round = (n: number) => Math.round(n * 10) / 10;

  return {
    seasonAverages: {
      PTS: round(pts),
      REB: round(reb),
      AST: round(ast),
      FG3M: round(fg3m),
      PRA: round(pts + reb + ast),
      MIN: round(min),
      STL: round(stl),
      BLK: round(blk),
      TOV: round(tov),
    },
    gamesPlayed: 20 + Math.floor(Math.random() * 25),
  };
}

function generateMockHitRates(avg: number, statType: string): Record<string, number> {
  const rates: Record<string, number> = {};
  const lines = [
    Math.max(0.5, Math.floor(avg - 3) + 0.5),
    Math.max(0.5, Math.floor(avg) + 0.5),
    Math.floor(avg + 3) + 0.5,
  ];

  for (const line of lines) {
    const diff = avg - line;
    let baseRate = 50 + (diff * 8);
    baseRate = Math.max(10, Math.min(95, baseRate + (Math.random() - 0.5) * 15));
    rates[line.toString()] = Math.round(baseRate * 10) / 10;
  }

  return rates;
}

function generateMockRecentGames(avgStats: { PTS: number; REB: number; AST: number; FG3M: number }): Array<{
  WL: string;
  PTS: number;
  REB: number;
  AST: number;
  FG3M: number;
  MIN: number;
  OPPONENT: string;
  GAME_DATE: string;
}> {
  const teams = ['LAL', 'BOS', 'MIA', 'GSW', 'PHX', 'DEN', 'MIL', 'PHI', 'NYK', 'BKN', 'ATL', 'CHI', 'CLE', 'DAL', 'HOU'];
  const games = [];

  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const gameDate = new Date(today);
    gameDate.setDate(gameDate.getDate() - (i * 2 + 1));
    const dateStr = gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();

    games.push({
      WL: Math.random() > 0.5 ? 'W' : 'L',
      PTS: Math.round(avgStats.PTS * (0.7 + Math.random() * 0.6)),
      REB: Math.round(avgStats.REB * (0.7 + Math.random() * 0.6)),
      AST: Math.round(avgStats.AST * (0.7 + Math.random() * 0.6)),
      FG3M: Math.round(avgStats.FG3M * (0.7 + Math.random() * 0.6)),
      MIN: Math.round(25 + Math.random() * 15),
      OPPONENT: teams[Math.floor(Math.random() * teams.length)],
      GAME_DATE: dateStr,
    });
  }

  return games;
}

export async function buildPlayerFromESPN(athlete: ESPNAthlete, team: ESPNTeam): Promise<InsertPlayer | null> {
  const positionName = athlete.position?.name || 'Guard';

  // Try to fetch real gamelog data from ESPN
  let realStats: PlayerRealStats | null = null;

  try {
    const gamelog = await fetchPlayerGamelog(athlete.id);

    if (gamelog.length > 0) {
      // Calculate real stats from gamelog
      const parseMin = (minStr: string) => {
        if (!minStr) return 0;
        const parts = minStr.split(':');
        return parseInt(parts[0]) + (parts[1] ? parseInt(parts[1]) / 60 : 0);
      };

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
    // Fall back to mock data if ESPN fetch fails
    console.warn(`Failed to fetch gamelog for ${athlete.displayName}, using mock data`);
  }

  // Use real stats if available, otherwise fall back to mock
  const { seasonAverages, gamesPlayed } = realStats || generateMockStats(positionName);
  const last10Averages = realStats?.last10Averages || {
    PTS: Math.round(seasonAverages.PTS * (0.9 + Math.random() * 0.2) * 10) / 10,
    REB: Math.round(seasonAverages.REB * (0.9 + Math.random() * 0.2) * 10) / 10,
    AST: Math.round(seasonAverages.AST * (0.9 + Math.random() * 0.2) * 10) / 10,
    FG3M: Math.round(seasonAverages.FG3M * (0.9 + Math.random() * 0.2) * 10) / 10,
    PRA: Math.round((seasonAverages.PTS + seasonAverages.REB + seasonAverages.AST) * (0.9 + Math.random() * 0.2) * 10) / 10,
    MIN: Math.round(seasonAverages.MIN * (0.9 + Math.random() * 0.2) * 10) / 10,
  };
  const last5Averages = realStats?.last5Averages || {
    PTS: Math.round(seasonAverages.PTS * (0.85 + Math.random() * 0.3) * 10) / 10,
    REB: Math.round(seasonAverages.REB * (0.85 + Math.random() * 0.3) * 10) / 10,
    AST: Math.round(seasonAverages.AST * (0.85 + Math.random() * 0.3) * 10) / 10,
    FG3M: Math.round(seasonAverages.FG3M * (0.85 + Math.random() * 0.3) * 10) / 10,
    PRA: Math.round((seasonAverages.PTS + seasonAverages.REB + seasonAverages.AST) * (0.85 + Math.random() * 0.3) * 10) / 10,
    MIN: Math.round(seasonAverages.MIN * (0.85 + Math.random() * 0.3) * 10) / 10,
  };
  const recentGames = realStats?.recentGames || generateMockRecentGames(seasonAverages);

  const hitRates = {
    PTS: generateMockHitRates(seasonAverages.PTS, 'PTS'),
    REB: generateMockHitRates(seasonAverages.REB, 'REB'),
    AST: generateMockHitRates(seasonAverages.AST, 'AST'),
    FG3M: generateMockHitRates(seasonAverages.FG3M, 'FG3M'),
    PRA: generateMockHitRates(seasonAverages.PRA, 'PRA'),
    STOCKS: generateMockHitRates(seasonAverages.STL + seasonAverages.BLK, 'STOCKS'),
  };

  const homeAvgs = {
    PTS: Math.round(seasonAverages.PTS * 1.05 * 10) / 10,
    REB: Math.round(seasonAverages.REB * 1.02 * 10) / 10,
    AST: Math.round(seasonAverages.AST * 1.03 * 10) / 10,
    PRA: Math.round(seasonAverages.PRA * 1.04 * 10) / 10,
  };

  const awayAvgs = {
    PTS: Math.round(seasonAverages.PTS * 0.95 * 10) / 10,
    REB: Math.round(seasonAverages.REB * 0.98 * 10) / 10,
    AST: Math.round(seasonAverages.AST * 0.97 * 10) / 10,
    PRA: Math.round(seasonAverages.PRA * 0.96 * 10) / 10,
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

