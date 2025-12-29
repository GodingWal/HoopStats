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
  } | null;
}

interface NBATeam {
  id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference: string;
  division: string;
}

export function isApiConfigured(): boolean {
  return !!API_KEY;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fetchAllTeams(): Promise<NBATeam[]> {
  const bdlApi = getApi();
  const response = await bdlApi.nba.getTeams();
  return response.data as unknown as NBATeam[];
}

export async function fetchAllNBAPlayers(): Promise<NBAPlayer[]> {
  const bdlApi = getApi();
  const allPlayers: NBAPlayer[] = [];
  let cursor: number | undefined = undefined;
  let isFirstRequest = true;
  
  console.log("Fetching all NBA players (free tier - 5 req/min limit)...");
  
  do {
    if (!isFirstRequest) {
      console.log("Waiting 15 seconds for rate limit...");
      await delay(15000);
    }
    isFirstRequest = false;
    
    const response = await bdlApi.nba.getPlayers({ 
      per_page: 100,
      cursor: cursor 
    });
    
    const players = response.data as unknown as NBAPlayer[];
    allPlayers.push(...players);
    cursor = response.meta?.next_cursor;
    
    console.log(`Fetched ${allPlayers.length} players so far...`);
  } while (cursor);
  
  return allPlayers.filter(p => p.team && p.team.id);
}

function generateMockStats(position: string): {
  seasonAverages: { PTS: number; REB: number; AST: number; FG3M: number; PRA: number; MIN: number; STL: number; BLK: number; TOV: number };
  gamesPlayed: number;
} {
  const isGuard = position.includes('G');
  const isCenter = position.includes('C');
  const isForward = position.includes('F');
  
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

export async function buildPlayerFromFreeData(player: NBAPlayer): Promise<InsertPlayer | null> {
  if (!player.team) return null;
  
  const { seasonAverages, gamesPlayed } = generateMockStats(player.position || 'G-F');
  
  if (gamesPlayed < 5) return null;
  
  const last10Factor = 0.9 + Math.random() * 0.2;
  const last5Factor = 0.85 + Math.random() * 0.3;
  
  const last10Averages = {
    PTS: Math.round(seasonAverages.PTS * last10Factor * 10) / 10,
    REB: Math.round(seasonAverages.REB * last10Factor * 10) / 10,
    AST: Math.round(seasonAverages.AST * last10Factor * 10) / 10,
    FG3M: Math.round(seasonAverages.FG3M * last10Factor * 10) / 10,
    PRA: Math.round((seasonAverages.PTS + seasonAverages.REB + seasonAverages.AST) * last10Factor * 10) / 10,
    MIN: Math.round(seasonAverages.MIN * last10Factor * 10) / 10,
  };
  
  const last5Averages = {
    PTS: Math.round(seasonAverages.PTS * last5Factor * 10) / 10,
    REB: Math.round(seasonAverages.REB * last5Factor * 10) / 10,
    AST: Math.round(seasonAverages.AST * last5Factor * 10) / 10,
    FG3M: Math.round(seasonAverages.FG3M * last5Factor * 10) / 10,
    PRA: Math.round((seasonAverages.PTS + seasonAverages.REB + seasonAverages.AST) * last5Factor * 10) / 10,
    MIN: Math.round(seasonAverages.MIN * last5Factor * 10) / 10,
  };
  
  const hitRates = {
    PTS: generateMockHitRates(seasonAverages.PTS, 'PTS'),
    REB: generateMockHitRates(seasonAverages.REB, 'REB'),
    AST: generateMockHitRates(seasonAverages.AST, 'AST'),
    FG3M: generateMockHitRates(seasonAverages.FG3M, 'FG3M'),
    PRA: generateMockHitRates(seasonAverages.PRA, 'PRA'),
    STOCKS: generateMockHitRates(seasonAverages.STL + seasonAverages.BLK, 'STOCKS'),
  };
  
  const recentGames = generateMockRecentGames(seasonAverages);
  
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
    player_id: player.id,
    player_name: `${player.first_name} ${player.last_name}`,
    team: player.team.abbreviation,
    team_id: player.team.id,
    games_played: gamesPlayed,
    season_averages: seasonAverages,
    last_10_averages: last10Averages,
    last_5_averages: last5Averages,
    hit_rates: hitRates,
    vs_team: {},
    recent_games: recentGames,
    home_averages: homeAvgs,
    away_averages: awayAvgs,
  };
}

export async function fetchAndBuildAllPlayers(
  progressCallback?: (current: number, total: number) => void
): Promise<InsertPlayer[]> {
  console.log("Fetching all NBA players...");
  const allPlayers = await fetchAllNBAPlayers();
  
  console.log(`Found ${allPlayers.length} players with teams. Building player data...`);
  
  const players: InsertPlayer[] = [];
  
  for (let i = 0; i < allPlayers.length; i++) {
    const player = allPlayers[i];
    progressCallback?.(i + 1, allPlayers.length);
    
    const playerData = await buildPlayerFromFreeData(player);
    if (playerData) {
      players.push(playerData);
    }
  }
  
  console.log(`Built data for ${players.length} players`);
  return players;
}
