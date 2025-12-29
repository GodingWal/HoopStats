import { BalldontlieAPI } from "@balldontlie/sdk";
import type { InsertPlayer } from "@shared/schema";

const API_KEY = process.env.BALLDONTLIE_API_KEY;

let api: BalldontlieAPI | null = null;

function getApi(): BalldontlieAPI {
  if (!api) {
    if (!API_KEY) {
      throw new Error("BALLDONTLIE_API_KEY environment variable is not set");
    }
    api = new BalldontlieAPI({ apiKey: API_KEY });
  }
  return api;
}

interface NBAPlayer {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  jersey_number: string;
  team: {
    id: number;
    abbreviation: string;
    city: string;
    name: string;
    full_name: string;
  };
}

interface NBASeasonAverage {
  player_id: number;
  season: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  min: string;
  turnover: number;
  games_played: number;
}

interface NBAStats {
  id: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  min: string;
  turnover: number;
  game: {
    id: number;
    date: string;
    status: string;
    home_team: { abbreviation: string };
    visitor_team: { abbreviation: string };
    home_team_score: number;
    visitor_team_score: number;
  };
  player: {
    id: number;
    first_name: string;
    last_name: string;
  };
  team: {
    id: number;
    abbreviation: string;
  };
}

function parseMinutes(min: string | null): number {
  if (!min) return 0;
  const parts = min.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0]) + parseInt(parts[1]) / 60;
  }
  return parseFloat(min) || 0;
}

function calculateHitRates(games: NBAStats[], stat: "pts" | "reb" | "ast" | "fg3m" | "pra" | "stocks", lines: number[]): Record<string, number> {
  const rates: Record<string, number> = {};
  if (games.length === 0) return rates;
  
  for (const line of lines) {
    let hits = 0;
    for (const game of games) {
      let value: number;
      if (stat === "pra") {
        value = game.pts + game.reb + game.ast;
      } else if (stat === "stocks") {
        value = game.stl + game.blk;
      } else {
        value = game[stat];
      }
      if (value > line) hits++;
    }
    rates[line.toString()] = (hits / games.length) * 100;
  }
  return rates;
}

function calculateAverages(games: NBAStats[]): { PTS: number; REB: number; AST: number; FG3M: number; PRA: number; MIN: number } {
  if (games.length === 0) {
    return { PTS: 0, REB: 0, AST: 0, FG3M: 0, PRA: 0, MIN: 0 };
  }
  
  const totals = games.reduce((acc, g) => ({
    pts: acc.pts + g.pts,
    reb: acc.reb + g.reb,
    ast: acc.ast + g.ast,
    fg3m: acc.fg3m + g.fg3m,
    min: acc.min + parseMinutes(g.min),
  }), { pts: 0, reb: 0, ast: 0, fg3m: 0, min: 0 });
  
  const n = games.length;
  return {
    PTS: Math.round((totals.pts / n) * 10) / 10,
    REB: Math.round((totals.reb / n) * 10) / 10,
    AST: Math.round((totals.ast / n) * 10) / 10,
    FG3M: Math.round((totals.fg3m / n) * 10) / 10,
    PRA: Math.round(((totals.pts + totals.reb + totals.ast) / n) * 10) / 10,
    MIN: Math.round((totals.min / n) * 10) / 10,
  };
}

export async function fetchAllNBAPlayers(): Promise<NBAPlayer[]> {
  const bdlApi = getApi();
  const allPlayers: NBAPlayer[] = [];
  let cursor: number | undefined = undefined;
  
  do {
    const response = await bdlApi.nba.getActivePlayers({ 
      per_page: 100,
      cursor: cursor 
    });
    allPlayers.push(...(response.data as unknown as NBAPlayer[]));
    cursor = response.meta?.next_cursor;
  } while (cursor);
  
  return allPlayers.filter(p => p.team && p.team.id);
}

export async function fetchActiveNBAPlayers(): Promise<NBAPlayer[]> {
  const allPlayers = await fetchAllNBAPlayers();
  return allPlayers.filter(p => p.team && p.team.id);
}

export async function fetchPlayerSeasonAverages(playerIds: number[], season: number = 2024): Promise<Map<number, NBASeasonAverage>> {
  const bdlApi = getApi();
  const averagesMap = new Map<number, NBASeasonAverage>();
  
  for (const playerId of playerIds) {
    try {
      const response = await bdlApi.nba.getSeasonAverages({
        season,
        player_id: playerId,
      });
      
      for (const avg of response.data as unknown as NBASeasonAverage[]) {
        if (avg.games_played > 0) {
          averagesMap.set(avg.player_id, avg);
        }
      }
    } catch (error) {
      // Silent fail for individual players
    }
    
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  
  return averagesMap;
}

export async function fetchPlayerGameLogs(playerId: number, limit: number = 20): Promise<NBAStats[]> {
  const bdlApi = getApi();
  
  try {
    const response = await bdlApi.nba.getStats({
      player_ids: [playerId],
      seasons: [2024],
      per_page: limit,
    });
    
    return (response.data as unknown as NBAStats[]).sort((a, b) => 
      new Date(b.game.date).getTime() - new Date(a.game.date).getTime()
    );
  } catch (error) {
    console.error(`Error fetching game logs for player ${playerId}:`, error);
    return [];
  }
}

export async function buildPlayerData(player: NBAPlayer, seasonAvg: NBASeasonAverage | undefined, gameLogs: NBAStats[]): Promise<InsertPlayer | null> {
  if (!seasonAvg || seasonAvg.games_played < 5) {
    return null;
  }
  
  const mins = parseMinutes(seasonAvg.min);
  const pra = seasonAvg.pts + seasonAvg.reb + seasonAvg.ast;
  
  const last10Games = gameLogs.slice(0, 10);
  const last5Games = gameLogs.slice(0, 5);
  
  const last10Avgs = calculateAverages(last10Games);
  const last5Avgs = calculateAverages(last5Games);
  
  const ptsLines = [Math.floor(seasonAvg.pts - 5) + 0.5, Math.floor(seasonAvg.pts) + 0.5, Math.floor(seasonAvg.pts + 5) + 0.5].filter(l => l > 0);
  const rebLines = [Math.floor(seasonAvg.reb - 2) + 0.5, Math.floor(seasonAvg.reb) + 0.5, Math.floor(seasonAvg.reb + 2) + 0.5].filter(l => l > 0);
  const astLines = [Math.floor(seasonAvg.ast - 2) + 0.5, Math.floor(seasonAvg.ast) + 0.5, Math.floor(seasonAvg.ast + 2) + 0.5].filter(l => l > 0);
  const fg3mLines = [Math.floor(seasonAvg.fg3m - 1) + 0.5, Math.floor(seasonAvg.fg3m) + 0.5, Math.floor(seasonAvg.fg3m + 1) + 0.5].filter(l => l >= 0);
  const praLines = [Math.floor(pra - 5) + 0.5, Math.floor(pra) + 0.5, Math.floor(pra + 5) + 0.5].filter(l => l > 0);
  const stocksLines = [1.5, 2.5, 3.5];
  
  const hitRates = {
    PTS: calculateHitRates(gameLogs, "pts", ptsLines),
    REB: calculateHitRates(gameLogs, "reb", rebLines),
    AST: calculateHitRates(gameLogs, "ast", astLines),
    FG3M: calculateHitRates(gameLogs, "fg3m", fg3mLines),
    PRA: calculateHitRates(gameLogs, "pra", praLines),
    STOCKS: calculateHitRates(gameLogs, "stocks", stocksLines),
  };
  
  const homeGames = gameLogs.filter(g => g.team.abbreviation === g.game.home_team.abbreviation);
  const awayGames = gameLogs.filter(g => g.team.abbreviation === g.game.visitor_team.abbreviation);
  
  const homeAvgs = calculateAverages(homeGames);
  const awayAvgs = calculateAverages(awayGames);
  
  const vsTeam: Record<string, { games: number; PTS: number; REB: number; AST: number; PRA: number; FG3M: number }> = {};
  for (const game of gameLogs) {
    const opponent = game.team.abbreviation === game.game.home_team.abbreviation 
      ? game.game.visitor_team.abbreviation 
      : game.game.home_team.abbreviation;
    
    if (!vsTeam[opponent]) {
      vsTeam[opponent] = { games: 0, PTS: 0, REB: 0, AST: 0, PRA: 0, FG3M: 0 };
    }
    vsTeam[opponent].games++;
    vsTeam[opponent].PTS += game.pts;
    vsTeam[opponent].REB += game.reb;
    vsTeam[opponent].AST += game.ast;
    vsTeam[opponent].FG3M += game.fg3m;
    vsTeam[opponent].PRA += game.pts + game.reb + game.ast;
  }
  
  for (const team of Object.keys(vsTeam)) {
    const data = vsTeam[team];
    vsTeam[team] = {
      games: data.games,
      PTS: Math.round((data.PTS / data.games) * 10) / 10,
      REB: Math.round((data.REB / data.games) * 10) / 10,
      AST: Math.round((data.AST / data.games) * 10) / 10,
      PRA: Math.round((data.PRA / data.games) * 10) / 10,
      FG3M: Math.round((data.FG3M / data.games) * 10) / 10,
    };
  }
  
  const recentGames = last5Games.map(g => {
    const isHome = g.team.abbreviation === g.game.home_team.abbreviation;
    const opponent = isHome ? g.game.visitor_team.abbreviation : g.game.home_team.abbreviation;
    const won = isHome 
      ? g.game.home_team_score > g.game.visitor_team_score 
      : g.game.visitor_team_score > g.game.home_team_score;
    
    return {
      GAME_DATE: new Date(g.game.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase(),
      OPPONENT: opponent,
      PTS: g.pts,
      REB: g.reb,
      AST: g.ast,
      FG3M: g.fg3m,
      WL: won ? "W" : "L",
      MIN: Math.round(parseMinutes(g.min)),
    };
  });
  
  return {
    player_id: player.id,
    player_name: `${player.first_name} ${player.last_name}`,
    team: player.team.abbreviation,
    team_id: player.team.id,
    games_played: seasonAvg.games_played,
    season_averages: {
      PTS: Math.round(seasonAvg.pts * 10) / 10,
      REB: Math.round(seasonAvg.reb * 10) / 10,
      AST: Math.round(seasonAvg.ast * 10) / 10,
      FG3M: Math.round(seasonAvg.fg3m * 10) / 10,
      STL: Math.round(seasonAvg.stl * 10) / 10,
      BLK: Math.round(seasonAvg.blk * 10) / 10,
      PRA: Math.round(pra * 10) / 10,
      MIN: Math.round(mins * 10) / 10,
      TOV: Math.round(seasonAvg.turnover * 10) / 10,
    },
    last_10_averages: last10Avgs,
    last_5_averages: last5Avgs,
    hit_rates: hitRates,
    vs_team: vsTeam,
    recent_games: recentGames,
    home_averages: homeAvgs,
    away_averages: awayAvgs,
  };
}

export async function fetchAndBuildAllPlayers(progressCallback?: (current: number, total: number) => void): Promise<InsertPlayer[]> {
  console.log("Fetching all NBA players...");
  const players = await fetchActiveNBAPlayers();
  console.log(`Found ${players.length} active players`);
  
  const playerIds = players.map(p => p.id);
  console.log("Fetching season averages...");
  const seasonAverages = await fetchPlayerSeasonAverages(playerIds);
  console.log(`Got season averages for ${seasonAverages.size} players`);
  
  const playersWithStats = players.filter(p => seasonAverages.has(p.id));
  console.log(`${playersWithStats.length} players have season stats`);
  
  const results: InsertPlayer[] = [];
  let processed = 0;
  
  for (const player of playersWithStats) {
    try {
      const gameLogs = await fetchPlayerGameLogs(player.id);
      const seasonAvg = seasonAverages.get(player.id);
      
      if (gameLogs.length >= 5) {
        const playerData = await buildPlayerData(player, seasonAvg, gameLogs);
        if (playerData) {
          results.push(playerData);
        }
      }
      
      processed++;
      if (progressCallback) {
        progressCallback(processed, playersWithStats.length);
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error(`Error processing player ${player.first_name} ${player.last_name}:`, error);
    }
  }
  
  console.log(`Built data for ${results.length} players`);
  return results;
}

export function isApiConfigured(): boolean {
  return !!process.env.BALLDONTLIE_API_KEY;
}
