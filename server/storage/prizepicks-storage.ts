/**
 * PrizePicks Line Storage
 * Handles database operations for PrizePicks line tracking
 */

import { db } from "../db";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import {
  prizePicksLines,
  prizePicksLineMovements,
  prizePicksDailyLines,
  type InsertPrizePicksLine,
  type DbPrizePicksLine,
  type InsertPrizePicksLineMovement,
  type DbPrizePicksLineMovement,
  type InsertPrizePicksDailyLine,
  type DbPrizePicksDailyLine,
} from "@shared/schema";
import type { PrizePicksLineStorage } from "../prizepicks-line-tracker";
import { dbLogger } from "../logger";
import { toDateString } from "./base";

/**
 * Database implementation for PrizePicks line storage
 */
export class PrizePicksStorageImpl implements PrizePicksLineStorage {
  /**
   * Save a PrizePicks line snapshot
   */
  async savePrizePicksLine(data: {
    prizePicksId: string;
    prizePicksPlayerId: string;
    playerName: string;
    team: string;
    teamAbbr?: string;
    position?: string;
    gameTime: Date;
    opponent?: string;
    statType: string;
    statTypeAbbr?: string;
    line: number;
    imageUrl?: string;
    isActive?: boolean;
  }): Promise<void> {
    if (!db) {
      dbLogger.warn("Database not initialized, skipping PrizePicks line save");
      return;
    }

    try {
      await db.insert(prizePicksLines).values({
        prizePicksId: data.prizePicksId,
        prizePicksPlayerId: data.prizePicksPlayerId,
        playerName: data.playerName,
        team: data.team,
        teamAbbr: data.teamAbbr,
        position: data.position,
        gameTime: data.gameTime,
        opponent: data.opponent,
        statType: data.statType,
        statTypeAbbr: data.statTypeAbbr,
        line: data.line,
        imageUrl: data.imageUrl,
        isActive: data.isActive ?? true,
      });

      // Update daily lines aggregate
      await this.updateDailyLines(data);

    } catch (error) {
      dbLogger.error("Failed to save PrizePicks line", error);
      throw error;
    }
  }

  /**
   * Update the daily lines aggregate table
   */
  private async updateDailyLines(data: {
    prizePicksPlayerId: string;
    playerName: string;
    team: string;
    statType: string;
    statTypeAbbr?: string;
    gameTime: Date;
    opponent?: string;
    line: number;
  }): Promise<void> {
    if (!db) return;

    const gameDate = toDateString(data.gameTime);
    const now = new Date();

    // Check if record exists
    const existing = await db
      .select()
      .from(prizePicksDailyLines)
      .where(
        and(
          eq(prizePicksDailyLines.prizePicksPlayerId, data.prizePicksPlayerId),
          eq(prizePicksDailyLines.statType, data.statType),
          eq(prizePicksDailyLines.gameDate, gameDate)
        )
      );

    if (existing.length === 0) {
      // Create new daily line record
      await db.insert(prizePicksDailyLines).values({
        prizePicksPlayerId: data.prizePicksPlayerId,
        playerName: data.playerName,
        team: data.team,
        statType: data.statType,
        statTypeAbbr: data.statTypeAbbr,
        gameDate,
        gameTime: data.gameTime,
        opponent: data.opponent,
        openingLine: data.line,
        closingLine: data.line,
        openingCapturedAt: now,
        closingCapturedAt: now,
        totalMovement: 0,
        netMovement: 0,
        numMovements: 0,
        highLine: data.line,
        lowLine: data.line,
      });
    } else {
      // Update existing record
      const record = existing[0];
      const netMovement = data.line - record.openingLine;
      const newHighLine = Math.max(record.highLine ?? data.line, data.line);
      const newLowLine = Math.min(record.lowLine ?? data.line, data.line);

      await db
        .update(prizePicksDailyLines)
        .set({
          closingLine: data.line,
          closingCapturedAt: now,
          netMovement,
          highLine: newHighLine,
          lowLine: newLowLine,
          updatedAt: now,
        })
        .where(eq(prizePicksDailyLines.id, record.id));
    }
  }

  /**
   * Save a PrizePicks line movement
   */
  async savePrizePicksLineMovement(data: {
    prizePicksPlayerId: string;
    playerName: string;
    statType: string;
    statTypeAbbr?: string;
    gameTime: Date;
    opponent?: string;
    oldLine: number;
    newLine: number;
    lineChange: number;
    direction: 'up' | 'down';
    magnitude: number;
    isSignificant: boolean;
  }): Promise<void> {
    if (!db) {
      dbLogger.warn("Database not initialized, skipping PrizePicks movement save");
      return;
    }

    try {
      await db.insert(prizePicksLineMovements).values({
        prizePicksPlayerId: data.prizePicksPlayerId,
        playerName: data.playerName,
        statType: data.statType,
        statTypeAbbr: data.statTypeAbbr,
        gameTime: data.gameTime,
        opponent: data.opponent,
        oldLine: data.oldLine,
        newLine: data.newLine,
        lineChange: data.lineChange,
        direction: data.direction,
        magnitude: data.magnitude,
        isSignificant: data.isSignificant,
      });

      // Update daily lines movement count
      const gameDate = toDateString(data.gameTime);
      await db
        .update(prizePicksDailyLines)
        .set({
          numMovements: sql`${prizePicksDailyLines.numMovements} + 1`,
          totalMovement: sql`${prizePicksDailyLines.totalMovement} + ${data.magnitude}`,
        })
        .where(
          and(
            eq(prizePicksDailyLines.prizePicksPlayerId, data.prizePicksPlayerId),
            eq(prizePicksDailyLines.statType, data.statType),
            eq(prizePicksDailyLines.gameDate, gameDate)
          )
        );

    } catch (error) {
      dbLogger.error("Failed to save PrizePicks line movement", error);
      throw error;
    }
  }

  /**
   * Get line history for a specific player/stat/game
   */
  async getPrizePicksLineHistory(
    prizePicksPlayerId: string,
    statType: string,
    gameTime: Date
  ): Promise<{
    lines: Array<{ line: number; capturedAt: Date }>;
    movements: Array<{
      oldLine: number;
      newLine: number;
      lineChange: number;
      direction: string;
      detectedAt: Date;
    }>;
  }> {
    if (!db) {
      return { lines: [], movements: [] };
    }

    // Get all line snapshots
    const lineSnapshots = await db
      .select({
        line: prizePicksLines.line,
        capturedAt: prizePicksLines.capturedAt,
      })
      .from(prizePicksLines)
      .where(
        and(
          eq(prizePicksLines.prizePicksPlayerId, prizePicksPlayerId),
          eq(prizePicksLines.statType, statType),
          eq(prizePicksLines.gameTime, gameTime)
        )
      )
      .orderBy(prizePicksLines.capturedAt);

    // Get all movements
    const movements = await db
      .select({
        oldLine: prizePicksLineMovements.oldLine,
        newLine: prizePicksLineMovements.newLine,
        lineChange: prizePicksLineMovements.lineChange,
        direction: prizePicksLineMovements.direction,
        detectedAt: prizePicksLineMovements.detectedAt,
      })
      .from(prizePicksLineMovements)
      .where(
        and(
          eq(prizePicksLineMovements.prizePicksPlayerId, prizePicksPlayerId),
          eq(prizePicksLineMovements.statType, statType),
          eq(prizePicksLineMovements.gameTime, gameTime)
        )
      )
      .orderBy(prizePicksLineMovements.detectedAt);

    return { lines: lineSnapshots, movements };
  }

  /**
   * Get all lines for a specific player
   */
  async getPrizePicksLinesByPlayer(playerName: string): Promise<Array<{
    statType: string;
    line: number;
    gameTime: Date;
    opponent?: string;
    capturedAt: Date;
  }>> {
    if (!db) {
      return [];
    }

    const result = await db
      .select({
        statType: prizePicksLines.statType,
        line: prizePicksLines.line,
        gameTime: prizePicksLines.gameTime,
        opponent: prizePicksLines.opponent,
        capturedAt: prizePicksLines.capturedAt,
      })
      .from(prizePicksLines)
      .where(eq(prizePicksLines.playerName, playerName))
      .orderBy(desc(prizePicksLines.capturedAt))
      .limit(100);

    return result.map(r => ({
      ...r,
      opponent: r.opponent ?? undefined,
    }));
  }

  /**
   * Get recent line movements
   */
  async getRecentPrizePicksMovements(limit: number = 50): Promise<Array<{
    playerName: string;
    statType: string;
    oldLine: number;
    newLine: number;
    lineChange: number;
    direction: string;
    isSignificant: boolean;
    detectedAt: Date;
  }>> {
    if (!db) {
      return [];
    }

    const result = await db
      .select({
        playerName: prizePicksLineMovements.playerName,
        statType: prizePicksLineMovements.statType,
        oldLine: prizePicksLineMovements.oldLine,
        newLine: prizePicksLineMovements.newLine,
        lineChange: prizePicksLineMovements.lineChange,
        direction: prizePicksLineMovements.direction,
        isSignificant: prizePicksLineMovements.isSignificant,
        detectedAt: prizePicksLineMovements.detectedAt,
      })
      .from(prizePicksLineMovements)
      .orderBy(desc(prizePicksLineMovements.detectedAt))
      .limit(limit);

    return result;
  }

  /**
   * Get daily line summaries for a specific date
   */
  async getPrizePicksDailyLines(date: Date): Promise<Array<{
    playerName: string;
    team: string;
    statType: string;
    openingLine: number;
    closingLine?: number;
    netMovement: number;
    numMovements: number;
    gameTime: Date;
  }>> {
    if (!db) {
      return [];
    }

    const dateString = toDateString(date);

    const result = await db
      .select({
        playerName: prizePicksDailyLines.playerName,
        team: prizePicksDailyLines.team,
        statType: prizePicksDailyLines.statType,
        openingLine: prizePicksDailyLines.openingLine,
        closingLine: prizePicksDailyLines.closingLine,
        netMovement: prizePicksDailyLines.netMovement,
        numMovements: prizePicksDailyLines.numMovements,
        gameTime: prizePicksDailyLines.gameTime,
      })
      .from(prizePicksDailyLines)
      .where(eq(prizePicksDailyLines.gameDate, dateString))
      .orderBy(prizePicksDailyLines.gameTime, prizePicksDailyLines.playerName);

    return result.map(r => ({
      ...r,
      closingLine: r.closingLine ?? undefined,
      netMovement: r.netMovement ?? 0,
      numMovements: r.numMovements ?? 0,
    }));
  }

  /**
   * Get all current lines (latest snapshot for each player/stat)
   */
  async getCurrentPrizePicksLines(): Promise<DbPrizePicksLine[]> {
    if (!db) {
      return [];
    }

    // Get latest line for each player/stat combination
    const subquery = db
      .select({
        prizePicksPlayerId: prizePicksLines.prizePicksPlayerId,
        statType: prizePicksLines.statType,
        gameTime: prizePicksLines.gameTime,
        maxCapturedAt: sql<Date>`MAX(${prizePicksLines.capturedAt})`.as('max_captured_at'),
      })
      .from(prizePicksLines)
      .where(eq(prizePicksLines.isActive, true))
      .groupBy(
        prizePicksLines.prizePicksPlayerId,
        prizePicksLines.statType,
        prizePicksLines.gameTime
      )
      .as('latest');

    // Join with full table to get all columns
    const result = await db
      .select()
      .from(prizePicksLines)
      .innerJoin(
        subquery,
        and(
          eq(prizePicksLines.prizePicksPlayerId, subquery.prizePicksPlayerId),
          eq(prizePicksLines.statType, subquery.statType),
          eq(prizePicksLines.gameTime, subquery.gameTime),
          eq(prizePicksLines.capturedAt, subquery.maxCapturedAt)
        )
      );

    return result.map(r => r.prizepicks_lines);
  }

  /**
   * Get line history for a date range
   */
  async getPrizePicksLineHistoryRange(
    startDate: Date,
    endDate: Date
  ): Promise<DbPrizePicksDailyLine[]> {
    if (!db) {
      return [];
    }

    const startDateStr = toDateString(startDate);
    const endDateStr = toDateString(endDate);

    const result = await db
      .select()
      .from(prizePicksDailyLines)
      .where(
        and(
          gte(prizePicksDailyLines.gameDate, startDateStr),
          sql`${prizePicksDailyLines.gameDate} <= ${endDateStr}`
        )
      )
      .orderBy(desc(prizePicksDailyLines.gameDate), prizePicksDailyLines.playerName);

    return result;
  }

  /**
   * Update actual value after game completes
   */
  async updatePrizePicksActualValue(
    prizePicksPlayerId: string,
    statType: string,
    gameDate: string,
    actualValue: number
  ): Promise<void> {
    if (!db) return;

    const hitOver = actualValue > 0; // Need to compare against closing line

    // Get the closing line
    const dailyLine = await db
      .select()
      .from(prizePicksDailyLines)
      .where(
        and(
          eq(prizePicksDailyLines.prizePicksPlayerId, prizePicksPlayerId),
          eq(prizePicksDailyLines.statType, statType),
          eq(prizePicksDailyLines.gameDate, gameDate)
        )
      );

    if (dailyLine.length > 0) {
      const closingLine = dailyLine[0].closingLine ?? dailyLine[0].openingLine;
      const hitOverActual = actualValue > closingLine;

      await db
        .update(prizePicksDailyLines)
        .set({
          actualValue,
          hitOver: hitOverActual,
          updatedAt: new Date(),
        })
        .where(eq(prizePicksDailyLines.id, dailyLine[0].id));
    }

    // Also mark line snapshots as inactive
    await db
      .update(prizePicksLines)
      .set({ isActive: false })
      .where(
        and(
          eq(prizePicksLines.prizePicksPlayerId, prizePicksPlayerId),
          eq(prizePicksLines.statType, statType),
          sql`DATE(${prizePicksLines.gameTime}) = ${gameDate}`
        )
      );
  }

  /**
   * Get significant movements for alerts
   */
  async getSignificantMovements(
    hours: number = 24
  ): Promise<DbPrizePicksLineMovement[]> {
    if (!db) {
      return [];
    }

    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);

    const result = await db
      .select()
      .from(prizePicksLineMovements)
      .where(
        and(
          eq(prizePicksLineMovements.isSignificant, true),
          gte(prizePicksLineMovements.detectedAt, cutoff)
        )
      )
      .orderBy(desc(prizePicksLineMovements.detectedAt));

    return result;
  }

  /**
   * Get player line trend (for a specific player and stat)
   */
  async getPlayerLineTrend(
    playerName: string,
    statType: string,
    days: number = 30
  ): Promise<Array<{
    gameDate: string;
    openingLine: number;
    closingLine?: number;
    actualValue?: number;
    hitOver?: boolean;
  }>> {
    if (!db) {
      return [];
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = toDateString(cutoff);

    const result = await db
      .select({
        gameDate: prizePicksDailyLines.gameDate,
        openingLine: prizePicksDailyLines.openingLine,
        closingLine: prizePicksDailyLines.closingLine,
        actualValue: prizePicksDailyLines.actualValue,
        hitOver: prizePicksDailyLines.hitOver,
      })
      .from(prizePicksDailyLines)
      .where(
        and(
          eq(prizePicksDailyLines.playerName, playerName),
          eq(prizePicksDailyLines.statType, statType),
          gte(prizePicksDailyLines.gameDate, cutoffStr)
        )
      )
      .orderBy(prizePicksDailyLines.gameDate);

    return result.map(r => ({
      ...r,
      closingLine: r.closingLine ?? undefined,
      actualValue: r.actualValue ?? undefined,
      hitOver: r.hitOver ?? undefined,
    }));
  }
}

// Export singleton instance
export const prizePicksStorage = new PrizePicksStorageImpl();
