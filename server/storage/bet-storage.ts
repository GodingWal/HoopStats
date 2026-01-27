/**
 * Bet storage operations
 */

import { eq, desc } from "drizzle-orm";
import { potentialBets, userBets } from "@shared/schema";
import type { PotentialBet, InsertPotentialBet, InsertUserBet, DbUserBet } from "@shared/schema";
import { assertDb, withTransaction } from "./base";

/**
 * Convert database bet to domain PotentialBet type
 */
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

/**
 * Get all potential bets sorted by hit rate
 */
export async function getPotentialBets(): Promise<PotentialBet[]> {
  const db = assertDb();
  const result = await db.select().from(potentialBets).orderBy(desc(potentialBets.hit_rate));
  return result.map(dbBetToPotentialBet);
}

/**
 * Create a new potential bet
 */
export async function createPotentialBet(bet: InsertPotentialBet): Promise<PotentialBet> {
  const db = assertDb();
  const [result] = await db.insert(potentialBets).values(bet).returning();
  return dbBetToPotentialBet(result);
}

/**
 * Update an existing potential bet
 */
export async function updatePotentialBet(id: number, updates: Partial<InsertPotentialBet>): Promise<PotentialBet> {
  const db = assertDb();
  const [result] = await db
    .update(potentialBets)
    .set(updates)
    .where(eq(potentialBets.id, id))
    .returning();
  return dbBetToPotentialBet(result);
}

/**
 * Clear all potential bets
 */
export async function clearPotentialBets(): Promise<void> {
  const db = assertDb();
  await db.delete(potentialBets);
}

/**
 * Refresh bets within a transaction (clear and insert)
 */
export async function refreshBetsWithTransaction(bets: InsertPotentialBet[]): Promise<PotentialBet[]> {
  return await withTransaction(async (tx) => {
    // Clear existing bets
    await tx.delete(potentialBets);

    // Insert new bets
    const results: PotentialBet[] = [];
    for (const bet of bets) {
      const [result] = await tx.insert(potentialBets).values(bet).returning();
      results.push(dbBetToPotentialBet(result));
    }

    return results;
  });
}

// ========================================
// USER BETS
// ========================================

/**
 * Save a user bet
 */
export async function saveUserBet(bet: InsertUserBet): Promise<DbUserBet> {
  const db = assertDb();
  const [result] = await db.insert(userBets).values(bet).returning();
  return result;
}

/**
 * Get user bets with optional filters
 */
export async function getUserBets(filters?: { pending?: boolean; gameDate?: string }): Promise<DbUserBet[]> {
  const db = assertDb();

  let query = db.select().from(userBets);

  // Note: Filtering will be done in application code for simplicity
  // In production, you'd want to build the query dynamically
  const results = await query.orderBy(desc(userBets.placedAt));

  return results.filter(bet => {
    if (filters?.pending && bet.result !== 'pending') return false;
    if (filters?.gameDate && bet.gameDate !== filters.gameDate) return false;
    return true;
  });
}

/**
 * Update user bet result
 */
export async function updateUserBetResult(
  betId: number,
  result: 'win' | 'loss' | 'push',
  actualValue: number,
  profit: number
): Promise<void> {
  const db = assertDb();
  await db.update(userBets)
    .set({
      result,
      actualValue,
      profit,
      settledAt: new Date(),
    })
    .where(eq(userBets.id, betId));
}
