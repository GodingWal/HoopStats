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
  clearPlayers(): Promise<void>;
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
    if (!db) throw new Error("Database not initialized");
    const result = await db.select().from(players);
    return result.map(dbPlayerToPlayer).sort(
      (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
    );
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.select().from(players).where(eq(players.player_id, id));
    return result ? dbPlayerToPlayer(result) : undefined;
  }

  async searchPlayers(query: string): Promise<Player[]> {
    if (!db) throw new Error("Database not initialized");
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
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(players).values(player as any).returning();
    return dbPlayerToPlayer(result);
  }

  async getPotentialBets(): Promise<PotentialBet[]> {
    if (!db) throw new Error("Database not initialized");
    const result = await db.select().from(potentialBets).orderBy(desc(potentialBets.hit_rate));
    return result.map(dbBetToPotentialBet);
  }

  async createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(potentialBets).values(bet).returning();
    return dbBetToPotentialBet(result);
  }

  async clearPotentialBets(): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.delete(potentialBets);
  }

  async clearPlayers(): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.delete(players);
  }

  async seedPlayers(data: Player[]): Promise<void> {
    if (!db) throw new Error("Database not initialized");
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

  async syncPlayers(data: InsertPlayer[]): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    for (const player of data) {
      await db.insert(players).values(player).onConflictDoUpdate({
        target: players.player_id,
        set: player,
      });
    }
  }
}

export class MemStorage implements IStorage {
  private players: Map<number, Player>;
  private bets: Map<number, PotentialBet>;
  private betIdCounter: number;

  constructor() {
    this.players = new Map();
    this.bets = new Map();
    this.betIdCounter = 1;
  }

  async getPlayers(): Promise<Player[]> {
    return Array.from(this.players.values()).sort(
      (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
    );
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    return this.players.get(id);
  }

  async searchPlayers(query: string): Promise<Player[]> {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.players.values())
      .filter(
        (p) =>
          p.player_name.toLowerCase().includes(lowerQuery) ||
          p.team.toLowerCase().includes(lowerQuery)
      )
      .sort(
        (a, b) => (b.season_averages?.PTS ?? 0) - (a.season_averages?.PTS ?? 0)
      );
  }

  async createPlayer(insertPlayer: InsertPlayer): Promise<Player> {
    const player: Player = {
      ...insertPlayer,
      games_played: insertPlayer.games_played ?? undefined,
      team_id: insertPlayer.team_id ?? undefined,
      season_averages: {
        ...insertPlayer.season_averages,
        STL: insertPlayer.season_averages.STL as number | undefined,
        BLK: insertPlayer.season_averages.BLK as number | undefined,
        TOV: insertPlayer.season_averages.TOV as number | undefined,
      },
      last_10_averages: insertPlayer.last_10_averages as Partial<SeasonAverages>,
      last_5_averages: insertPlayer.last_5_averages as Partial<SeasonAverages>,
      vs_team: Object.entries(insertPlayer.vs_team).reduce(
        (acc, [key, val]) => ({
          ...acc,
          [key]: {
            ...val,
            FG3M: val.FG3M as number | undefined
          }
        }),
        {} as Record<string, VsTeamStats>
      ),
      recent_games: insertPlayer.recent_games as GameLog[],
      hit_rates: insertPlayer.hit_rates as HitRates,
      home_averages: insertPlayer.home_averages as SplitAverages,
      away_averages: insertPlayer.away_averages as SplitAverages,
    };
    this.players.set(player.player_id, player);
    return player;
  }

  async getPotentialBets(): Promise<PotentialBet[]> {
    return Array.from(this.bets.values()).sort((a, b) => b.hit_rate - a.hit_rate);
  }

  async createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet> {
    const id = this.betIdCounter++;
    const newBet: PotentialBet = {
      ...bet,
      id,
      last_5_avg: bet.last_5_avg ?? undefined,
      recommendation: bet.recommendation as "OVER" | "UNDER",
      confidence: bet.confidence as "HIGH" | "MEDIUM" | "LOW"
    };
    this.bets.set(id, newBet);
    return newBet;
  }

  async clearPotentialBets(): Promise<void> {
    this.bets.clear();
  }

  async clearPlayers(): Promise<void> {
    this.players.clear();
  }

  async seedPlayers(data: Player[]): Promise<void> {
    for (const player of data) {
      if (!this.players.has(player.player_id)) {
        this.players.set(player.player_id, player);
      }
    }
  }

  async syncPlayers(data: InsertPlayer[]): Promise<void> {
    for (const player of data) {
      await this.createPlayer(player);
    }
  }
}


export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();
