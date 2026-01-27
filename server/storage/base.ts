/**
 * Base storage utilities and shared types
 */

import { db } from "../db";
import { dbLogger } from "../logger";

/**
 * Check if database is initialized
 */
export function assertDb(): typeof db {
  if (!db) {
    throw new Error("Database not initialized");
  }
  return db;
}

/**
 * Execute a function within a database transaction
 */
export async function withTransaction<T>(
  fn: (tx: typeof db) => Promise<T>
): Promise<T> {
  const database = assertDb();

  // Drizzle ORM transaction support
  return await database.transaction(async (tx) => {
    try {
      return await fn(tx as typeof db);
    } catch (error) {
      dbLogger.error("Transaction failed, rolling back", error);
      throw error;
    }
  });
}

/**
 * Format date to ISO date string (YYYY-MM-DD)
 */
export function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get today's date string
 */
export function getTodayString(): string {
  return toDateString(new Date());
}

/**
 * Calculate cutoff date for time-based queries
 */
export function getCutoffDate(days: number): Date {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff;
}

export { db };
