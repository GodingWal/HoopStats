/**
 * BallDontLie API service for NBA player stats
 */

import { BalldontlieAPI } from "@balldontlie/sdk";
import { apiLogger } from "../logger";

let client: BalldontlieAPI | null = null;

function getClient(): BalldontlieAPI {
  if (!client) {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) throw new Error("BALLDONTLIE_API_KEY not set");
    client = new BalldontlieAPI({ apiKey });
  }
  return client;
}

export interface PlayerSeasonStats {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  gamesPlayed: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  fg_pct: number;
  min: string;
  season: number;
}

/**
 * Search for a player by name and return their current season averages
 */
export async function getPlayerStatsByName(name: string): Promise<PlayerSeasonStats | null> {
  try {
    const api = getClient();
    const currentSeason = new Date().getFullYear();
    // NBA season crosses years: 2024-25 season = 2024
    const season = new Date().getMonth() < 7 ? currentSeason - 1 : currentSeason;

    // Search for the player
    const playersRes = await api.nba.getPlayers({ search: name, per_page: 5 });
    if (!playersRes.data || playersRes.data.length === 0) return null;

    const player = playersRes.data[0];

    // Get season averages
    const statsRes = await api.nba.getSeasonAverages({ season, player_id: player.id });
    if (!statsRes.data || statsRes.data.length === 0) return null;

    const stats = statsRes.data[0];
    return {
      playerId: player.id,
      playerName: `${player.first_name} ${player.last_name}`,
      team: player.team?.abbreviation || "",
      position: player.position || "",
      gamesPlayed: stats.games_played,
      pts: stats.pts,
      reb: stats.reb,
      ast: stats.ast,
      stl: stats.stl,
      blk: stats.blk,
      fg3m: stats.fg3m,
      fg_pct: stats.fg_pct,
      min: stats.min,
      season,
    };
  } catch (error) {
    apiLogger.error("BallDontLie getPlayerStatsByName error", { name, error });
    return null;
  }
}

/**
 * Get stats for multiple players (recent game stats)
 */
export async function getRecentPlayerGames(
  playerIds: number[],
  numGames: number = 5
): Promise<Array<{ playerId: number; games: Array<{ date: string; pts: number; reb: number; ast: number; fg3m: number; min: string; opponent: string }> }>> {
  try {
    const api = getClient();
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - 30); // last 30 days

    const statsRes = await api.nba.getStats({
      player_ids: playerIds,
      start_date: startDate.toISOString().split("T")[0],
      end_date: today.toISOString().split("T")[0],
      per_page: 100,
    });

    if (!statsRes.data) return [];

    // Group by player
    const byPlayer: Record<number, typeof statsRes.data> = {};
    for (const stat of statsRes.data) {
      if (!byPlayer[stat.player.id]) byPlayer[stat.player.id] = [];
      byPlayer[stat.player.id].push(stat);
    }

    return Object.entries(byPlayer).map(([id, games]) => ({
      playerId: Number(id),
      games: games
        .sort((a, b) => b.game.date.localeCompare(a.game.date))
        .slice(0, numGames)
        .map((g) => ({
          date: g.game.date,
          pts: g.pts,
          reb: g.reb,
          ast: g.ast,
          fg3m: g.fg3m,
          min: g.min,
          opponent:
            g.team.id === g.game.home_team.id
              ? g.game.visitor_team.abbreviation
              : g.game.home_team.abbreviation,
        })),
    }));
  } catch (error) {
    apiLogger.error("BallDontLie getRecentPlayerGames error", { error });
    return [];
  }
}

/**
 * Get active NBA players with current season stats (paginated)
 */
export async function getActivePlayersWithStats(cursor?: number): Promise<{
  players: PlayerSeasonStats[];
  nextCursor?: number;
}> {
  try {
    const api = getClient();
    const currentSeason = new Date().getFullYear();
    const season = new Date().getMonth() < 7 ? currentSeason - 1 : currentSeason;

    const playersRes = await api.nba.getActivePlayers({
      per_page: 25,
      cursor,
    });

    if (!playersRes.data || playersRes.data.length === 0) {
      return { players: [] };
    }

    const playerIds = playersRes.data.map((p) => p.id);

    // Fetch season averages for all these players in parallel (batch requests)
    const statsPromises = playerIds.map((id) =>
      api.nba.getSeasonAverages({ season, player_id: id }).catch(() => null)
    );
    const statsResults = await Promise.all(statsPromises);

    const players: PlayerSeasonStats[] = [];
    for (let i = 0; i < playersRes.data.length; i++) {
      const player = playersRes.data[i];
      const statsRes = statsResults[i];
      if (!statsRes?.data || statsRes.data.length === 0) continue;
      const stats = statsRes.data[0];
      players.push({
        playerId: player.id,
        playerName: `${player.first_name} ${player.last_name}`,
        team: player.team?.abbreviation || "",
        position: player.position || "",
        gamesPlayed: stats.games_played,
        pts: stats.pts,
        reb: stats.reb,
        ast: stats.ast,
        stl: stats.stl,
        blk: stats.blk,
        fg3m: stats.fg3m,
        fg_pct: stats.fg_pct,
        min: stats.min,
        season,
      });
    }

    return {
      players,
      nextCursor: playersRes.meta?.next_cursor,
    };
  } catch (error) {
    apiLogger.error("BallDontLie getActivePlayersWithStats error", { error });
    return { players: [] };
  }
}
