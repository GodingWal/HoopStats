/**
 * Player storage operations
 */

import { eq, ilike, or, desc } from "drizzle-orm";
import { players } from "@shared/schema";
import type { Player, InsertPlayer, SeasonAverages, HitRates, VsTeamStats, GameLog, SplitAverages } from "@shared/schema";
import { assertDb, withTransaction } from "./base";

/**
 * Convert database player to domain Player type
 */
function dbPlayerToPlayer(dbPlayer: typeof players.$inferSelect): Player {
  return {
    player_id: dbPlayer.player_id,
    player_name: dbPlayer.player_name,
    team: dbPlayer.team,
    team_id: dbPlayer.team_id ?? undefined,
    games_played: dbPlayer.games_played ?? undefined,
    season_averages: dbPlayer.season_averages as SeasonAverages,
    last_10_averages: dbPlayer.last_10_averages as Partial<SeasonAverages>,
    last_5_averages: dbPlayer.last_5_averages as Partial<SeasonAverages>,
    hit_rates: dbPlayer.hit_rates as HitRates,
    vs_team: dbPlayer.vs_team as Record<string, VsTeamStats>,
    recent_games: dbPlayer.recent_games as GameLog[],
    home_averages: dbPlayer.home_averages as SplitAverages,
    away_averages: dbPlayer.away_averages as SplitAverages,
  };
}

/**
 * Get all players sorted by points
 */
export async function getPlayers(): Promise<Player[]> {
  const db = assertDb();
  const result = await db.select().from(players);
  return result.map(dbPlayerToPlayer).sort(
    (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
  );
}

/**
 * Get a single player by ID
 */
export async function getPlayer(id: number): Promise<Player | undefined> {
  const db = assertDb();
  const [result] = await db.select().from(players).where(eq(players.player_id, id));
  return result ? dbPlayerToPlayer(result) : undefined;
}

/**
 * Search players by name or team
 */
export async function searchPlayers(query: string): Promise<Player[]> {
  const db = assertDb();
  const searchPattern = `%${query}%`;
  const result = await db.select().from(players).where(
    or(
      ilike(players.player_name, searchPattern),
      ilike(players.team, searchPattern)
    )
  );
  return result.map(dbPlayerToPlayer).sort(
    (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
  );
}

/**
 * Create a new player
 */
export async function createPlayer(player: InsertPlayer): Promise<Player> {
  const db = assertDb();
  const [result] = await db.insert(players).values(player as any).returning();
  return dbPlayerToPlayer(result);
}

/**
 * Clear all players
 */
export async function clearPlayers(): Promise<void> {
  const db = assertDb();
  await db.delete(players);
}

/**
 * Seed players from sample data (only inserts if not exists)
 */
export async function seedPlayers(data: Player[]): Promise<void> {
  const db = assertDb();
  for (const player of data) {
    const existing = await db.select().from(players).where(eq(players.player_id, player.player_id));
    if (existing.length === 0) {
      await db.insert(players).values({
        player_id: player.player_id,
        player_name: player.player_name,
        team: player.team,
        team_id: player.team_id ?? null,
        games_played: player.games_played ?? null,
        season_averages: player.season_averages,
        last_10_averages: player.last_10_averages,
        last_5_averages: player.last_5_averages,
        hit_rates: player.hit_rates,
        vs_team: player.vs_team,
        recent_games: player.recent_games,
        home_averages: player.home_averages,
        away_averages: player.away_averages,
      });
    }
  }
}

/**
 * Sync players (upsert)
 */
export async function syncPlayers(data: InsertPlayer[]): Promise<void> {
  const db = assertDb();
  for (const player of data) {
    await db.insert(players).values(player).onConflictDoUpdate({
      target: players.player_id,
      set: player,
    });
  }
}

/**
 * Sync players within a transaction
 */
export async function syncPlayersWithTransaction(data: InsertPlayer[]): Promise<void> {
  await withTransaction(async (tx) => {
    for (const player of data) {
      await tx.insert(players).values(player).onConflictDoUpdate({
        target: players.player_id,
        set: player,
      });
    }
  });
}
