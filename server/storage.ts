import type { Player, PotentialBet, InsertPlayer, InsertPotentialBet, SeasonAverages, HitRates, VsTeamStats, GameLog, SplitAverages, InsertProjection, DbProjection, InsertRecommendation, DbRecommendation, InsertTeamDefense, DbTeamDefense, TrackRecord, PropEvaluation, InsertSportsbook, DbSportsbook, InsertPlayerPropLine, DbPlayerPropLine, InsertLineMovement, DbLineMovement, InsertBestLine, DbBestLine, InsertUserBet, DbUserBet, LineComparison, InsertPlayerOnOffSplit, DbPlayerOnOffSplit, InsertParlay, DbParlay, InsertParlayPick, DbParlayPick, Alert, InsertAlert } from "@shared/schema";
import { players, potentialBets, projections, recommendations, teamDefense, sportsbooks, playerPropLines, lineMovements, bestLines, userBets, playerOnOffSplits, parlays, parlayPicks, alerts } from "@shared/schema";
import { db } from "./db";
import { eq, ilike, or, desc, and, gte, sql, inArray, avg, max, min, count } from "drizzle-orm";

export interface IStorage {
  getPlayers(): Promise<Player[]>;
  getPlayer(id: number): Promise<Player | undefined>;
  searchPlayers(query: string): Promise<Player[]>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  getPotentialBets(): Promise<PotentialBet[]>;
  createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet>;
  updatePotentialBet(id: number, updates: Partial<InsertPotentialBet>): Promise<PotentialBet>;
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

  // Sportsbooks
  getSportsbooks(): Promise<DbSportsbook[]>;
  upsertSportsbook(sportsbook: InsertSportsbook): Promise<DbSportsbook>;

  // Player prop lines
  savePlayerPropLine(line: InsertPlayerPropLine): Promise<DbPlayerPropLine>;
  getPlayerPropLines(playerId: number, stat: string, gameDate?: string): Promise<DbPlayerPropLine[]>;
  getLatestLines(playerId: number, stat: string): Promise<DbPlayerPropLine[]>;
  getAllLinesForGame(gameId: string): Promise<DbPlayerPropLine[]>;

  // Line movements
  saveLineMovement(movement: InsertLineMovement): Promise<DbLineMovement>;
  getLineMovements(playerId: number, stat: string, gameDate?: string): Promise<DbLineMovement[]>;
  getRecentLineMovements(hours?: number): Promise<DbLineMovement[]>;

  // Best lines
  updateBestLines(playerId: number, stat: string, gameDate: string): Promise<void>;
  getBestLines(playerId: number, stat: string): Promise<DbBestLine | undefined>;
  getBestLinesForDate(gameDate: string): Promise<DbBestLine[]>;

  // User bets
  saveUserBet(bet: InsertUserBet): Promise<DbUserBet>;
  getUserBets(filters?: { pending?: boolean; gameDate?: string }): Promise<DbUserBet[]>;
  updateUserBetResult(betId: number, result: 'win' | 'loss' | 'push', actualValue: number, profit: number): Promise<void>;

  // Parlays
  saveParlay(parlay: Omit<InsertParlay, 'placedAt'>, picks: Omit<InsertParlayPick, 'parlayId'>[]): Promise<DbParlay>;
  getParlays(filters?: { pending?: boolean }): Promise<Array<DbParlay & { picks: DbParlayPick[] }>>;
  updateParlayResult(parlayId: number, result: 'win' | 'loss' | 'push', profit: number): Promise<DbParlay>;
  updateParlayPickResult(pickId: number, result: 'hit' | 'miss' | 'push', actualValue: number): Promise<DbParlayPick>;

  // Line comparison
  compareLines(playerId: number, stat: string, gameDate: string): Promise<LineComparison>;

  // On/Off Splits
  savePlayerOnOffSplit(split: InsertPlayerOnOffSplit): Promise<DbPlayerOnOffSplit>;
  getPlayerOnOffSplits(withoutPlayerId: number, season?: string): Promise<DbPlayerOnOffSplit[]>;
  getTopBeneficiaries(withoutPlayerId: number, stat: 'pts' | 'reb' | 'ast', limit: number): Promise<DbPlayerOnOffSplit[]>;
  getOnOffSplitsByTeam(teamAbbr: string, season?: string): Promise<DbPlayerOnOffSplit[]>;
  deleteStaleOnOffSplits(olderThanDays: number): Promise<void>;

  // Alerts
  getAlerts(params?: { unreadOnly?: boolean; limit?: number }): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertAsRead(id: number): Promise<void>;
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

  async updatePotentialBet(id: number, updates: Partial<InsertPotentialBet>): Promise<PotentialBet> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db
      .update(potentialBets)
      .set(updates)
      .where(eq(potentialBets.id, id))
      .returning();
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

  // ========================================
  // SPORTSBOOKS METHODS
  // ========================================

  async getSportsbooks(): Promise<DbSportsbook[]> {
    if (!db) throw new Error("Database not initialized");
    return await db.select().from(sportsbooks).where(eq(sportsbooks.active, true));
  }

  async upsertSportsbook(sportsbook: InsertSportsbook): Promise<DbSportsbook> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(sportsbooks).values(sportsbook)
      .onConflictDoUpdate({
        target: sportsbooks.key,
        set: { name: sportsbook.name, active: sportsbook.active, lastSync: sportsbook.lastSync },
      })
      .returning();
    return result;
  }

  // ========================================
  // PLAYER PROP LINES METHODS
  // ========================================

  async savePlayerPropLine(line: InsertPlayerPropLine): Promise<DbPlayerPropLine> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(playerPropLines).values(line).returning();
    return result;
  }

  async getPlayerPropLines(playerId: number, stat: string, gameDate?: string): Promise<DbPlayerPropLine[]> {
    if (!db) throw new Error("Database not initialized");

    const conditions = [
      eq(playerPropLines.playerId, playerId),
      eq(playerPropLines.stat, stat),
      eq(playerPropLines.isActive, true),
    ];

    if (gameDate) {
      conditions.push(eq(playerPropLines.gameDate, gameDate));
    }

    return await db.select().from(playerPropLines)
      .where(and(...conditions))
      .orderBy(desc(playerPropLines.capturedAt));
  }

  async getLatestLines(playerId: number, stat: string): Promise<DbPlayerPropLine[]> {
    if (!db) throw new Error("Database not initialized");

    // Get the most recent timestamp for this player/stat
    const latest = await db.select({ maxTime: sql<Date>`MAX(${playerPropLines.capturedAt})` })
      .from(playerPropLines)
      .where(
        and(
          eq(playerPropLines.playerId, playerId),
          eq(playerPropLines.stat, stat),
          eq(playerPropLines.isActive, true)
        )
      );

    if (!latest[0]?.maxTime) return [];

    // Get all lines from that timestamp (all sportsbooks)
    return await db.select().from(playerPropLines)
      .where(
        and(
          eq(playerPropLines.playerId, playerId),
          eq(playerPropLines.stat, stat),
          eq(playerPropLines.capturedAt, latest[0].maxTime),
          eq(playerPropLines.isActive, true)
        )
      );
  }

  async getAllLinesForGame(gameId: string): Promise<DbPlayerPropLine[]> {
    if (!db) throw new Error("Database not initialized");
    return await db.select().from(playerPropLines)
      .where(
        and(
          eq(playerPropLines.gameId, gameId),
          eq(playerPropLines.isActive, true)
        )
      )
      .orderBy(desc(playerPropLines.capturedAt));
  }

  // ========================================
  // LINE MOVEMENTS METHODS
  // ========================================

  async saveLineMovement(movement: InsertLineMovement): Promise<DbLineMovement> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(lineMovements).values(movement).returning();
    return result;
  }

  async getLineMovements(playerId: number, stat: string, gameDate?: string): Promise<DbLineMovement[]> {
    if (!db) throw new Error("Database not initialized");

    const conditions = [
      eq(lineMovements.playerId, playerId),
      eq(lineMovements.stat, stat),
    ];

    if (gameDate) {
      conditions.push(eq(lineMovements.gameDate, gameDate));
    }

    return await db.select().from(lineMovements)
      .where(and(...conditions))
      .orderBy(desc(lineMovements.detectedAt));
  }

  async getRecentLineMovements(hours: number = 24): Promise<DbLineMovement[]> {
    if (!db) throw new Error("Database not initialized");

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    return await db.select().from(lineMovements)
      .where(
        and(
          gte(lineMovements.detectedAt, cutoff),
          eq(lineMovements.isSignificant, true)
        )
      )
      .orderBy(desc(lineMovements.detectedAt));
  }

  // ========================================
  // BEST LINES METHODS
  // ========================================

  async updateBestLines(playerId: number, stat: string, gameDate: string): Promise<void> {
    if (!db) throw new Error("Database not initialized");

    // Get all current lines for this player/stat/date
    const lines = await db.select().from(playerPropLines)
      .where(
        and(
          eq(playerPropLines.playerId, playerId),
          eq(playerPropLines.stat, stat),
          eq(playerPropLines.gameDate, gameDate),
          eq(playerPropLines.isActive, true)
        )
      );

    if (lines.length === 0) return;

    // Find best over (highest line, best odds if tied)
    let bestOver = lines[0];
    for (const line of lines) {
      if (line.line > bestOver.line ||
        (line.line === bestOver.line && line.overOdds > bestOver.overOdds)) {
        bestOver = line;
      }
    }

    // Find best under (lowest line, best odds if tied)
    let bestUnder = lines[0];
    for (const line of lines) {
      if (line.line < bestUnder.line ||
        (line.line === bestUnder.line && line.underOdds > bestUnder.underOdds)) {
        bestUnder = line;
      }
    }

    // Calculate consensus
    const consensusLine = lines.reduce((sum, l) => sum + l.line, 0) / lines.length;
    const lineValues = lines.map(l => l.line);
    const lineSpread = Math.max(...lineValues) - Math.min(...lineValues);

    const playerName = lines[0].playerName;
    const gameId = lines[0].gameId;

    // Upsert best lines
    await db.insert(bestLines).values({
      playerId,
      playerName,
      gameId,
      gameDate,
      stat,
      bestOverLine: bestOver.line,
      bestOverOdds: bestOver.overOdds,
      bestOverBook: bestOver.sportsbookKey,
      bestUnderLine: bestUnder.line,
      bestUnderOdds: bestUnder.underOdds,
      bestUnderBook: bestUnder.sportsbookKey,
      consensusLine,
      numBooks: lines.length,
      lineSpread,
    }).onConflictDoUpdate({
      target: [bestLines.playerId, bestLines.stat, bestLines.gameDate],
      set: {
        bestOverLine: bestOver.line,
        bestOverOdds: bestOver.overOdds,
        bestOverBook: bestOver.sportsbookKey,
        bestUnderLine: bestUnder.line,
        bestUnderOdds: bestUnder.underOdds,
        bestUnderBook: bestUnder.sportsbookKey,
        consensusLine,
        numBooks: lines.length,
        lineSpread,
      },
    });
  }

  async getBestLines(playerId: number, stat: string): Promise<DbBestLine | undefined> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.select().from(bestLines)
      .where(
        and(
          eq(bestLines.playerId, playerId),
          eq(bestLines.stat, stat)
        )
      )
      .orderBy(desc(bestLines.lastUpdated))
      .limit(1);
    return result;
  }

  async getBestLinesForDate(gameDate: string): Promise<DbBestLine[]> {
    if (!db) throw new Error("Database not initialized");
    return await db.select().from(bestLines)
      .where(eq(bestLines.gameDate, gameDate))
      .orderBy(desc(bestLines.lastUpdated));
  }

  // ========================================
  // USER BETS METHODS
  // ========================================

  async saveUserBet(bet: InsertUserBet): Promise<DbUserBet> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(userBets).values(bet).returning();
    return result;
  }

  async getUserBets(filters?: { pending?: boolean; gameDate?: string }): Promise<DbUserBet[]> {
    if (!db) throw new Error("Database not initialized");

    const conditions = [];

    if (filters?.pending) {
      conditions.push(eq(userBets.result, 'pending'));
    }

    if (filters?.gameDate) {
      conditions.push(eq(userBets.gameDate, filters.gameDate));
    }

    return await db.select().from(userBets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(userBets.placedAt));
  }

  async updateUserBetResult(betId: number, result: 'win' | 'loss' | 'push', actualValue: number, profit: number): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.update(userBets)
      .set({
        result,
        actualValue,
        profit,
        settledAt: new Date(),
      })
      .where(eq(userBets.id, betId));
  }

  // ========================================
  // PARLAY METHODS
  // ========================================

  async saveParlay(parlay: Omit<InsertParlay, 'placedAt'>, picks: Omit<InsertParlayPick, 'parlayId'>[]): Promise<DbParlay> {
    if (!db) throw new Error("Database not initialized");

    const [savedParlay] = await db.insert(parlays).values(parlay).returning();

    // Insert picks with the parlay ID
    await db.insert(parlayPicks).values(
      picks.map(pick => ({ ...pick, parlayId: savedParlay.id }))
    );

    return savedParlay;
  }

  async getParlays(filters?: { pending?: boolean }): Promise<Array<DbParlay & { picks: DbParlayPick[] }>> {
    if (!db) throw new Error("Database not initialized");

    const conditions = [];

    if (filters?.pending) {
      conditions.push(eq(parlays.result, 'pending'));
    }

    const allParlays = await db.select().from(parlays)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(parlays.placedAt));

    // Fetch picks for each parlay
    const parlaysWithPicks = await Promise.all(
      allParlays.map(async (parlay) => {
        const picks = await db.select().from(parlayPicks)
          .where(eq(parlayPicks.parlayId, parlay.id));
        return { ...parlay, picks };
      })
    );

    return parlaysWithPicks;
  }

  async updateParlayResult(parlayId: number, result: 'win' | 'loss' | 'push', profit: number): Promise<DbParlay> {
    if (!db) throw new Error("Database not initialized");
    const [updated] = await db.update(parlays)
      .set({
        result,
        profit,
        settledAt: new Date(),
      })
      .where(eq(parlays.id, parlayId))
      .returning();
    return updated;
  }

  async updateParlayPickResult(pickId: number, result: 'hit' | 'miss' | 'push', actualValue: number): Promise<DbParlayPick> {
    if (!db) throw new Error("Database not initialized");
    const [updated] = await db.update(parlayPicks)
      .set({
        result,
        actualValue,
      })
      .where(eq(parlayPicks.id, pickId))
      .returning();
    return updated;
  }

  // ========================================
  // LINE COMPARISON METHODS
  // ========================================

  async compareLines(playerId: number, stat: string, gameDate: string): Promise<LineComparison> {
    if (!db) throw new Error("Database not initialized");

    // Get latest lines from all sportsbooks
    const lines = await this.getPlayerPropLines(playerId, stat, gameDate);

    if (lines.length === 0) {
      throw new Error("No lines available for comparison");
    }

    const playerName = lines[0].playerName;

    // Format lines for comparison
    const formattedLines = lines.map(l => ({
      sportsbook: l.sportsbookKey,
      line: l.line,
      overOdds: l.overOdds,
      underOdds: l.underOdds,
      overImpliedProb: l.overProb,
      underImpliedProb: l.underProb,
      vig: l.vig,
    }));

    // Find best over and under
    let bestOver = lines[0];
    let bestUnder = lines[0];

    for (const line of lines) {
      if (line.line > bestOver.line ||
        (line.line === bestOver.line && line.overOdds > bestOver.overOdds)) {
        bestOver = line;
      }
      if (line.line < bestUnder.line ||
        (line.line === bestUnder.line && line.underOdds > bestUnder.underOdds)) {
        bestUnder = line;
      }
    }

    // Calculate consensus
    const consensusLine = lines.reduce((sum, l) => sum + l.line, 0) / lines.length;
    const lineValues = lines.map(l => l.line);
    const spread = Math.max(...lineValues) - Math.min(...lineValues);

    return {
      playerId,
      playerName,
      stat,
      gameDate,
      lines: formattedLines,
      bestOver: {
        sportsbook: bestOver.sportsbookKey,
        line: bestOver.line,
        odds: bestOver.overOdds,
      },
      bestUnder: {
        sportsbook: bestUnder.sportsbookKey,
        line: bestUnder.line,
        odds: bestUnder.underOdds,
      },
      consensus: {
        line: consensusLine,
        spread,
      },
    };
  }

  // ========================================
  // ON/OFF SPLITS METHODS
  // ========================================

  async savePlayerOnOffSplit(split: InsertPlayerOnOffSplit): Promise<DbPlayerOnOffSplit> {
    if (!db) throw new Error("Database not initialized");

    const result = await db
      .insert(playerOnOffSplits)
      .values({
        ...split,
        calculatedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [playerOnOffSplits.playerId, playerOnOffSplits.withoutPlayerId, playerOnOffSplits.season],
        set: {
          gamesWithTeammate: split.gamesWithTeammate,
          gamesWithoutTeammate: split.gamesWithoutTeammate,
          ptsWithTeammate: split.ptsWithTeammate,
          rebWithTeammate: split.rebWithTeammate,
          astWithTeammate: split.astWithTeammate,
          minWithTeammate: split.minWithTeammate,
          fgaWithTeammate: split.fgaWithTeammate,
          ptsWithoutTeammate: split.ptsWithoutTeammate,
          rebWithoutTeammate: split.rebWithoutTeammate,
          astWithoutTeammate: split.astWithoutTeammate,
          minWithoutTeammate: split.minWithoutTeammate,
          fgaWithoutTeammate: split.fgaWithoutTeammate,
          ptsDelta: split.ptsDelta,
          rebDelta: split.rebDelta,
          astDelta: split.astDelta,
          minDelta: split.minDelta,
          fgaDelta: split.fgaDelta,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  }

  async getPlayerOnOffSplits(withoutPlayerId: number, season?: string): Promise<DbPlayerOnOffSplit[]> {
    if (!db) throw new Error("Database not initialized");

    const query = db
      .select()
      .from(playerOnOffSplits)
      .where(eq(playerOnOffSplits.withoutPlayerId, withoutPlayerId));

    if (season) {
      const result = await query.where(
        and(
          eq(playerOnOffSplits.withoutPlayerId, withoutPlayerId),
          eq(playerOnOffSplits.season, season)
        )
      );
      return result;
    }

    return await query;
  }

  async getTopBeneficiaries(
    withoutPlayerId: number,
    stat: 'pts' | 'reb' | 'ast',
    limit: number
  ): Promise<DbPlayerOnOffSplit[]> {
    if (!db) throw new Error("Database not initialized");

    const deltaColumn =
      stat === 'pts' ? playerOnOffSplits.ptsDelta :
        stat === 'reb' ? playerOnOffSplits.rebDelta :
          playerOnOffSplits.astDelta;

    const result = await db
      .select()
      .from(playerOnOffSplits)
      .where(
        and(
          eq(playerOnOffSplits.withoutPlayerId, withoutPlayerId),
          gte(playerOnOffSplits.gamesWithoutTeammate, 3) // Minimum sample size
        )
      )
      .orderBy(desc(deltaColumn))
      .limit(limit);

    return result;
  }

  async getOnOffSplitsByTeam(teamAbbr: string, season?: string): Promise<DbPlayerOnOffSplit[]> {
    if (!db) throw new Error("Database not initialized");

    const query = db
      .select()
      .from(playerOnOffSplits)
      .where(eq(playerOnOffSplits.team, teamAbbr));

    if (season) {
      const result = await query.where(
        and(
          eq(playerOnOffSplits.team, teamAbbr),
          eq(playerOnOffSplits.season, season)
        )
      );
      return result;
    }

    return await query;
  }

  async deleteStaleOnOffSplits(olderThanDays: number): Promise<void> {
    if (!db) throw new Error("Database not initialized");

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    await db.delete(playerOnOffSplits).where(sql`${playerOnOffSplits.updatedAt} < ${cutoffDate}`);
  }

  // Alerts
  async getAlerts(params?: { unreadOnly?: boolean; limit?: number }): Promise<Alert[]> {
    if (!db) throw new Error("Database not initialized");

    // Simple query since we can't easily do dynamic filtering with this ORM pattern in one line
    // Accessing raw query builder
    const result = await db.select().from(alerts).orderBy(desc(alerts.created_at));

    let filtered = result;
    if (params?.unreadOnly) {
      filtered = filtered.filter(a => !a.read);
    }
    if (params?.limit) {
      filtered = filtered.slice(0, params.limit);
    }
    return filtered;
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    if (!db) throw new Error("Database not initialized");
    const [result] = await db.insert(alerts).values(alert).returning();
    return result;
  }

  async markAlertAsRead(id: number): Promise<void> {
    if (!db) throw new Error("Database not initialized");
    await db.update(alerts).set({ read: true }).where(eq(alerts.id, id));
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
  private parlaysMap: Map<number, DbParlay & { picks: DbParlayPick[] }>;
  private parlayIdCounter: number;
  private parlayPickIdCounter: number;

  private splitsMap: Map<number, DbPlayerOnOffSplit[]>;
  private splitsIdCounter: number;

  constructor() {
    this.players = new Map();
    this.bets = new Map();
    this.betIdCounter = 1;
    this.projectionsMap = new Map();
    this.projectionsIdCounter = 1;
    this.recommendationsMap = new Map();
    this.recommendationsIdCounter = 1;
    this.teamDefenseMap = new Map();
    this.parlaysMap = new Map();
    this.parlayIdCounter = 1;
    this.parlayPickIdCounter = 1;
    this.splitsMap = new Map();
    this.splitsIdCounter = 1;
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

  async updatePotentialBet(id: number, updates: Partial<InsertPotentialBet>): Promise<PotentialBet> {
    const existingBet = this.bets.get(id);
    if (!existingBet) {
      throw new Error(`Bet with id ${id} not found`);
    }
    const updatedBet: PotentialBet = {
      ...existingBet,
      ...updates,
      id,
      recommendation: (updates.recommendation as "OVER" | "UNDER") ?? existingBet.recommendation,
      confidence: (updates.confidence as "HIGH" | "MEDIUM" | "LOW") ?? existingBet.confidence,
    };
    this.bets.set(id, updatedBet);
    return updatedBet;
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
      projectionId: recommendation.projectionId ?? null,
      recommendedBetSize: recommendation.recommendedBetSize ?? null,
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
      defRating: defense.defRating ?? null,
      pace: defense.pace ?? null,
      oppPtsAllowed: defense.oppPtsAllowed ?? null,
      oppRebAllowed: defense.oppRebAllowed ?? null,
      oppAstAllowed: defense.oppAstAllowed ?? null,
      opp3PtPctAllowed: defense.opp3PtPctAllowed ?? null,
      updatedAt: new Date(),
    });
  }

  // ========================================
  // STUBS FOR MISSING METHODS
  // ========================================

  async getSportsbooks(): Promise<DbSportsbook[]> { return []; }
  async upsertSportsbook(sportsbook: InsertSportsbook): Promise<DbSportsbook> { throw new Error("Not implemented in MemStorage"); }

  async savePlayerPropLine(line: InsertPlayerPropLine): Promise<DbPlayerPropLine> { throw new Error("Not implemented in MemStorage"); }
  async getPlayerPropLines(playerId: number, stat: string, gameDate?: string): Promise<DbPlayerPropLine[]> { return []; }
  async getLatestLines(playerId: number, stat: string): Promise<DbPlayerPropLine[]> { return []; }
  async getAllLinesForGame(gameId: string): Promise<DbPlayerPropLine[]> { return []; }

  async saveLineMovement(movement: InsertLineMovement): Promise<DbLineMovement> { throw new Error("Not implemented in MemStorage"); }
  async getLineMovements(playerId: number, stat: string, gameDate?: string): Promise<DbLineMovement[]> { return []; }
  async getRecentLineMovements(hours: number = 24): Promise<DbLineMovement[]> { return []; }

  async updateBestLines(playerId: number, stat: string, gameDate: string): Promise<void> { }
  async getBestLines(playerId: number, stat: string): Promise<DbBestLine | undefined> { return undefined; }
  async getBestLinesForDate(gameDate: string): Promise<DbBestLine[]> { return []; }

  async saveUserBet(bet: InsertUserBet): Promise<DbUserBet> { throw new Error("Not implemented in MemStorage"); }
  async getUserBets(filters?: { pending?: boolean; gameDate?: string }): Promise<DbUserBet[]> { return []; }
  async updateUserBetResult(betId: number, result: 'win' | 'loss' | 'push', actualValue: number, profit: number): Promise<void> { }

  async saveParlay(parlay: Omit<InsertParlay, 'placedAt'>, picks: Omit<InsertParlayPick, 'parlayId'>[]): Promise<DbParlay> {
    const id = this.parlayIdCounter++;
    const newParlay: DbParlay = {
      id,
      ...parlay,
      placedAt: new Date(),
      settledAt: null,
    };

    const savedPicks: DbParlayPick[] = picks.map(pick => ({
      id: this.parlayPickIdCounter++,
      parlayId: id,
      ...pick,
      result: 'pending' as const,
      actualValue: null,
    }));

    this.parlaysMap.set(id, { ...newParlay, picks: savedPicks });
    return newParlay;
  }

  async getParlays(filters?: { pending?: boolean }): Promise<Array<DbParlay & { picks: DbParlayPick[] }>> {
    let result = Array.from(this.parlaysMap.values());

    if (filters?.pending) {
      result = result.filter(p => p.result === 'pending');
    }

    return result.sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
  }

  async updateParlayResult(parlayId: number, result: 'win' | 'loss' | 'push', profit: number): Promise<DbParlay> {
    const parlay = this.parlaysMap.get(parlayId);
    if (!parlay) {
      throw new Error(`Parlay with id ${parlayId} not found`);
    }

    parlay.result = result;
    parlay.profit = profit;
    parlay.settledAt = new Date();

    return parlay;
  }

  async updateParlayPickResult(pickId: number, result: 'hit' | 'miss' | 'push', actualValue: number): Promise<DbParlayPick> {
    for (const parlay of this.parlaysMap.values()) {
      const pick = parlay.picks.find(p => p.id === pickId);
      if (pick) {
        pick.result = result;
        pick.actualValue = actualValue;
        return pick;
      }
    }
    throw new Error(`Pick with id ${pickId} not found`);
  }

  async compareLines(playerId: number, stat: string, gameDate: string): Promise<LineComparison> { throw new Error("Not implemented in MemStorage"); }

  async savePlayerOnOffSplit(split: InsertPlayerOnOffSplit): Promise<DbPlayerOnOffSplit> {
    const id = this.splitsIdCounter++;
    const newSplit: DbPlayerOnOffSplit = {
      id,
      ...split,
      ptsWithTeammate: split.ptsWithTeammate ?? null,
      rebWithTeammate: split.rebWithTeammate ?? null,
      astWithTeammate: split.astWithTeammate ?? null,
      minWithTeammate: split.minWithTeammate ?? null,
      fgaWithTeammate: split.fgaWithTeammate ?? null,
      ptsDelta: split.ptsDelta ?? null,
      rebDelta: split.rebDelta ?? null,
      astDelta: split.astDelta ?? null,
      minDelta: split.minDelta ?? null,
      fgaDelta: split.fgaDelta ?? null,
      calculatedAt: new Date()
    };

    // Store by withoutPlayerId
    const existing = this.splitsMap.get(split.withoutPlayerId) || [];
    existing.push(newSplit);
    this.splitsMap.set(split.withoutPlayerId, existing);

    return newSplit;
  }

  async getPlayerOnOffSplits(withoutPlayerId: number, season?: string): Promise<DbPlayerOnOffSplit[]> {
    let splits = this.splitsMap.get(withoutPlayerId) || [];
    if (season) {
      splits = splits.filter(s => s.season === season);
    }
    return splits;
  }

  async getTopBeneficiaries(withoutPlayerId: number, stat: 'pts' | 'reb' | 'ast', limit: number): Promise<DbPlayerOnOffSplit[]> {
    const splits = await this.getPlayerOnOffSplits(withoutPlayerId);

    // Filter significant sample size
    const validSplits = splits.filter(s => s.gamesWithoutTeammate >= 3);

    return validSplits.sort((a, b) => {
      // Map stat to delta field
      let valA = 0;
      let valB = 0;

      switch (stat) {
        case 'pts': valA = a.ptsDelta ?? 0; valB = b.ptsDelta ?? 0; break;
        case 'reb': valA = a.rebDelta ?? 0; valB = b.rebDelta ?? 0; break;
        case 'ast': valA = a.astDelta ?? 0; valB = b.astDelta ?? 0; break;
      }

      return valB - valA; // Descending
    }).slice(0, limit);
  }

  async getOnOffSplitsByTeam(teamAbbr: string, season?: string): Promise<DbPlayerOnOffSplit[]> {
    const allSplits: DbPlayerOnOffSplit[] = [];
    for (const splits of this.splitsMap.values()) {
      allSplits.push(...splits.filter(s => s.team === teamAbbr && (season ? s.season === season : true)));
    }
    return allSplits;
  }

  async deleteStaleOnOffSplits(olderThanDays: number): Promise<void> {
    // Basic cleanup logic could go here
  }

  // Alerts
  alerts: Alert[] = [];
  alertIdCounter = 1;

  async getAlerts(params?: { unreadOnly?: boolean; limit?: number }): Promise<Alert[]> {
    let filtered = this.alerts;
    if (params?.unreadOnly) {
      filtered = filtered.filter(a => !a.read);
    }
    filtered = filtered.sort((a, b) =>
      (b.created_at?.getTime() ?? 0) - (a.created_at?.getTime() ?? 0)
    );
    if (params?.limit) {
      filtered = filtered.slice(0, params.limit);
    }
    return filtered;
  }

  async createAlert(alert: InsertAlert): Promise<Alert> {
    const newAlert: Alert = {
      ...alert,
      id: this.alertIdCounter++,
      created_at: new Date(),
      read: false,
      metadata: alert.metadata ?? null,
      severity: alert.severity ?? "INFO",
    };
    this.alerts.push(newAlert);
    return newAlert;
  }

  async markAlertAsRead(id: number): Promise<void> {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.read = true;
    }
  }
}


export const storage = process.env.DATABASE_URL ? new DatabaseStorage() : new MemStorage();
