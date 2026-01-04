import type { Player, PotentialBet, InsertPlayer, InsertPotentialBet, SeasonAverages, HitRates, VsTeamStats, GameLog, SplitAverages, InsertProjection, DbProjection, InsertRecommendation, DbRecommendation, InsertTeamDefense, DbTeamDefense, TrackRecord, PropEvaluation } from "@shared/schema";
import { players, potentialBets, projections, recommendations, teamDefense } from "@shared/schema";
import { db } from "./db";
import { eq, ilike, or, desc, and, gte, sql } from "drizzle-orm";

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

  // Projections
  createProjection(projection: InsertProjection): Promise<DbProjection>;
  getProjectionsByDate(date: Date): Promise<DbProjection[]>;
  updateProjectionActual(id: number, actualValue: number, hit: boolean): Promise<void>;

  // Recommendations
  createRecommendation(recommendation: InsertRecommendation): Promise<DbRecommendation>;
  getRecommendationsByDate(date: Date): Promise<DbRecommendation[]>;
  getTodaysRecommendations(): Promise<DbRecommendation[]>;

  // Track record
  getTrackRecord(days: number): Promise<TrackRecord>;

  // Team defense
  getTeamDefense(teamId: number): Promise<DbTeamDefense | undefined>;
  upsertTeamDefense(defense: InsertTeamDefense): Promise<void>;
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

  // ========================================
  // PROJECTIONS METHODS
  // ========================================

  async createProjection(projection: InsertProjection): Promise<DbProjection> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(projections).values(projection).returning();
    return result;
  }

  async getProjectionsByDate(date: Date): Promise<DbProjection[]> {
    if (!db) throw new Error("Database not initialized");
    const dateStr = date.toISOString().split('T')[0];
    const result = await db.select().from(projections).where(eq(projections.gameDate, dateStr));
    return result;
  }

  async updateProjectionActual(id: number, actualValue: number, hit: boolean): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.update(projections)
      .set({ actualValue, hit })
      .where(eq(projections.id, id));
  }

  // ========================================
  // RECOMMENDATIONS METHODS
  // ========================================

  async createRecommendation(recommendation: InsertRecommendation): Promise<DbRecommendation> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(recommendations).values(recommendation).returning();
    return result;
  }

  async getRecommendationsByDate(date: Date): Promise<DbRecommendation[]> {
    if (!db) throw new Error("Database not initialized");
    const dateStr = date.toISOString().split('T')[0];
    const result = await db.select().from(recommendations)
      .where(eq(recommendations.gameDate, dateStr))
      .orderBy(desc(recommendations.edge));
    return result;
  }

  async getTodaysRecommendations(): Promise<DbRecommendation[]> {
    return this.getRecommendationsByDate(new Date());
  }

  // ========================================
  // TRACK RECORD METHODS
  // ========================================

  async getTrackRecord(days: number): Promise<TrackRecord> {
    if (!db) throw new Error("Database not initialized");

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    // Get all recommendations with actuals from the last N days
    const recs = await db.select()
      .from(recommendations)
      .innerJoin(projections, eq(recommendations.projectionId, projections.id))
      .where(
        and(
          gte(recommendations.gameDate, cutoffStr),
          sql`${projections.actualValue} IS NOT NULL`
        )
      );

    let wins = 0;
    let total = 0;
    let profit = 0;

    const byConfidence = {
      high: { wins: 0, total: 0, hitRate: 0 },
      medium: { wins: 0, total: 0, hitRate: 0 },
      low: { wins: 0, total: 0, hitRate: 0 }
    };

    const byStat: Record<string, { wins: number; total: number; hitRate: number }> = {};
    const equityCurveMap = new Map<string, number>();

    for (const row of recs) {
      const rec = row.recommendations;
      const proj = row.projections;

      if (proj.hit !== null) {
        total++;
        const won = proj.hit;
        if (won) wins++;

        // Update profit (assuming -110 odds, risk 1 unit)
        profit += won ? 0.91 : -1;

        // By confidence
        const conf = rec.confidence.toLowerCase() as 'high' | 'medium' | 'low';
        byConfidence[conf].total++;
        if (won) byConfidence[conf].wins++;

        // By stat
        if (!byStat[rec.stat]) {
          byStat[rec.stat] = { wins: 0, total: 0, hitRate: 0 };
        }
        byStat[rec.stat].total++;
        if (won) byStat[rec.stat].wins++;

        // Equity curve
        const dateStr = proj.gameDate?.toString() || '';
        const currentProfit = equityCurveMap.get(dateStr) || 0;
        equityCurveMap.set(dateStr, currentProfit + (won ? 0.91 : -1));
      }
    }

    // Calculate hit rates
    byConfidence.high.hitRate = byConfidence.high.total > 0 ? byConfidence.high.wins / byConfidence.high.total : 0;
    byConfidence.medium.hitRate = byConfidence.medium.total > 0 ? byConfidence.medium.wins / byConfidence.medium.total : 0;
    byConfidence.low.hitRate = byConfidence.low.total > 0 ? byConfidence.low.wins / byConfidence.low.total : 0;

    for (const stat in byStat) {
      byStat[stat].hitRate = byStat[stat].total > 0 ? byStat[stat].wins / byStat[stat].total : 0;
    }

    // Build equity curve
    const equityCurve = Array.from(equityCurveMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, dailyProfit], i, arr) => ({
        date,
        profit: arr.slice(0, i + 1).reduce((sum, [_, p]) => sum + p, 0)
      }));

    // Calibration (simplified - would need more data)
    const calibration = [
      { predicted: 0.5, actual: 0.5, count: total > 0 ? Math.floor(total / 10) : 0 },
      { predicted: 0.6, actual: 0.6, count: total > 0 ? Math.floor(total / 10) : 0 },
      { predicted: 0.7, actual: 0.7, count: total > 0 ? Math.floor(total / 10) : 0 },
    ];

    return {
      total,
      wins,
      losses: total - wins,
      hitRate: total > 0 ? wins / total : 0,
      roi: total > 0 ? profit / total : 0,
      profit,
      byConfidence,
      byStat,
      equityCurve,
      calibration
    };
  }

  // ========================================
  // TEAM DEFENSE METHODS
  // ========================================

  async getTeamDefense(teamId: number): Promise<DbTeamDefense | undefined> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.select().from(teamDefense).where(eq(teamDefense.teamId, teamId));
    return result;
  }

  async upsertTeamDefense(defense: InsertTeamDefense): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.insert(teamDefense).values(defense).onConflictDoUpdate({
      target: teamDefense.teamId,
      set: defense,
    });
  }
}

export class MemStorage implements IStorage {
  private players: Map<number, Player>;
  private bets: Map<number, PotentialBet>;
  private betIdCounter: number;
  private projectionsMap: Map<number, DbProjection>;
  private projectionsIdCounter: number;
  private recommendationsMap: Map<number, DbRecommendation>;
  private recommendationsIdCounter: number;
  private teamDefenseMap: Map<number, DbTeamDefense>;

  constructor() {
    this.players = new Map();
    this.bets = new Map();
    this.betIdCounter = 1;
    this.projectionsMap = new Map();
    this.projectionsIdCounter = 1;
    this.recommendationsMap = new Map();
    this.recommendationsIdCounter = 1;
    this.teamDefenseMap = new Map();
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

  // ========================================
  // PROJECTIONS METHODS (MemStorage)
  // ========================================

  async createProjection(projection: InsertProjection): Promise<DbProjection> {
    const id = this.projectionsIdCounter++;
    const newProjection: DbProjection = {
      id,
      ...projection,
      actualValue: null,
      hit: null,
      createdAt: new Date(),
    };
    this.projectionsMap.set(id, newProjection);
    return newProjection;
  }

  async getProjectionsByDate(date: Date): Promise<DbProjection[]> {
    const dateStr = date.toISOString().split('T')[0];
    return Array.from(this.projectionsMap.values())
      .filter(p => p.gameDate === dateStr);
  }

  async updateProjectionActual(id: number, actualValue: number, hit: boolean): Promise<void> {
    const projection = this.projectionsMap.get(id);
    if (projection) {
      projection.actualValue = actualValue;
      projection.hit = hit;
    }
  }

  // ========================================
  // RECOMMENDATIONS METHODS (MemStorage)
  // ========================================

  async createRecommendation(recommendation: InsertRecommendation): Promise<DbRecommendation> {
    const id = this.recommendationsIdCounter++;
    const newRecommendation: DbRecommendation = {
      id,
      ...recommendation,
      userBet: false,
      profit: null,
      createdAt: new Date(),
    };
    this.recommendationsMap.set(id, newRecommendation);
    return newRecommendation;
  }

  async getRecommendationsByDate(date: Date): Promise<DbRecommendation[]> {
    const dateStr = date.toISOString().split('T')[0];
    return Array.from(this.recommendationsMap.values())
      .filter(r => r.gameDate === dateStr)
      .sort((a, b) => b.edge - a.edge);
  }

  async getTodaysRecommendations(): Promise<DbRecommendation[]> {
    return this.getRecommendationsByDate(new Date());
  }

  // ========================================
  // TRACK RECORD METHODS (MemStorage)
  // ========================================

  async getTrackRecord(days: number): Promise<TrackRecord> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    const relevantRecs = Array.from(this.recommendationsMap.values())
      .filter(r => r.gameDate >= cutoffStr);

    let wins = 0;
    let total = 0;
    let profit = 0;

    const byConfidence = {
      high: { wins: 0, total: 0, hitRate: 0 },
      medium: { wins: 0, total: 0, hitRate: 0 },
      low: { wins: 0, total: 0, hitRate: 0 }
    };

    const byStat: Record<string, { wins: number; total: number; hitRate: number }> = {};
    const equityCurveMap = new Map<string, number>();

    for (const rec of relevantRecs) {
      if (rec.projectionId) {
        const proj = this.projectionsMap.get(rec.projectionId);
        if (proj && proj.hit !== null) {
          total++;
          const won = proj.hit;
          if (won) wins++;

          profit += won ? 0.91 : -1;

          const conf = rec.confidence.toLowerCase() as 'high' | 'medium' | 'low';
          byConfidence[conf].total++;
          if (won) byConfidence[conf].wins++;

          if (!byStat[rec.stat]) {
            byStat[rec.stat] = { wins: 0, total: 0, hitRate: 0 };
          }
          byStat[rec.stat].total++;
          if (won) byStat[rec.stat].wins++;

          const dateStr = proj.gameDate || '';
          const currentProfit = equityCurveMap.get(dateStr) || 0;
          equityCurveMap.set(dateStr, currentProfit + (won ? 0.91 : -1));
        }
      }
    }

    byConfidence.high.hitRate = byConfidence.high.total > 0 ? byConfidence.high.wins / byConfidence.high.total : 0;
    byConfidence.medium.hitRate = byConfidence.medium.total > 0 ? byConfidence.medium.wins / byConfidence.medium.total : 0;
    byConfidence.low.hitRate = byConfidence.low.total > 0 ? byConfidence.low.wins / byConfidence.low.total : 0;

    for (const stat in byStat) {
      byStat[stat].hitRate = byStat[stat].total > 0 ? byStat[stat].wins / byStat[stat].total : 0;
    }

    const equityCurve = Array.from(equityCurveMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, dailyProfit], i, arr) => ({
        date,
        profit: arr.slice(0, i + 1).reduce((sum, [_, p]) => sum + p, 0)
      }));

    const calibration = [
      { predicted: 0.5, actual: 0.5, count: total > 0 ? Math.floor(total / 10) : 0 },
      { predicted: 0.6, actual: 0.6, count: total > 0 ? Math.floor(total / 10) : 0 },
      { predicted: 0.7, actual: 0.7, count: total > 0 ? Math.floor(total / 10) : 0 },
    ];

    return {
      total,
      wins,
      losses: total - wins,
      hitRate: total > 0 ? wins / total : 0,
      roi: total > 0 ? profit / total : 0,
      profit,
      byConfidence,
      byStat,
      equityCurve,
      calibration
    };
  }

  // ========================================
  // TEAM DEFENSE METHODS (MemStorage)
  // ========================================

  async getTeamDefense(teamId: number): Promise<DbTeamDefense | undefined> {
    return this.teamDefenseMap.get(teamId);
  }

  async upsertTeamDefense(defense: InsertTeamDefense): Promise<void> {
    const existing = this.teamDefenseMap.get(defense.teamId);
    this.teamDefenseMap.set(defense.teamId, {
      ...defense,
      updatedAt: new Date(),
    });
  }
}


export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();
