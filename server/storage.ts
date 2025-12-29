import type { Player, PotentialBet, InsertPlayer, InsertPotentialBet, SeasonAverages, HitRates, VsTeamStats, GameLog, SplitAverages } from "@shared/schema";
import { players, potentialBets } from "@shared/schema";
import { db } from "./db";
import { eq, ilike, or, desc } from "drizzle-orm";

export interface IStorage {
  getPlayers(): Promise<Player[]>;
  getPlayer(id: number): Promise<Player | undefined>;
  searchPlayers(query: string): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  getPotentialBets(): Promise<PotentialBet[]>;
  createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet>;
  clearPotentialBets(): Promise<void>;
  seedPlayers(data: Player[]): Promise<void>;
}

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

function dbBetToPotentialBet(dbBet: typeof potentialBets.$inferSelect): PotentialBet {
  return {
    id: dbBet.id,
    player_id: dbBet.player_id,
    player_name: dbBet.player_name,
    team: dbBet.team,
    stat_type: dbBet.stat_type,
    line: dbBet.line,
    hit_rate: dbBet.hit_rate,
    season_avg: dbBet.season_avg,
    last_5_avg: dbBet.last_5_avg ?? undefined,
    recommendation: dbBet.recommendation as "OVER" | "UNDER",
    confidence: dbBet.confidence as "HIGH" | "MEDIUM" | "LOW",
  };
}

export class DatabaseStorage implements IStorage {
  async getPlayers(): Promise<Player[]> {
    const result = await db.select().from(players);
    return result.map(dbPlayerToPlayer).sort(
      (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
    );
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    const [result] = await db.select().from(players).where(eq(players.player_id, id));
    return result ? dbPlayerToPlayer(result) : undefined;
  }

  async searchPlayers(query: string): Promise<Player[]> {
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

  async createPlayer(player: InsertPlayer): Promise<Player> {
    const [result] = await db.insert(players).values(player).returning();
    return dbPlayerToPlayer(result);
  }

  async getPotentialBets(): Promise<PotentialBet[]> {
    const result = await db.select().from(potentialBets).orderBy(desc(potentialBets.hit_rate));
    return result.map(dbBetToPotentialBet);
  }

  async createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet> {
    const [result] = await db.insert(potentialBets).values(bet).returning();
    return dbBetToPotentialBet(result);
  }

  async clearPotentialBets(): Promise<void> {
    await db.delete(potentialBets);
  }

  async seedPlayers(data: Player[]): Promise<void> {
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
}

export const storage = new DatabaseStorage();
