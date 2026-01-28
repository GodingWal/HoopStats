/**
 * Storage module - combines all entity storage operations
 * This provides backward compatibility with the existing IStorage interface
 */

import type {
  Player, PotentialBet, InsertPlayer, InsertPotentialBet,
  InsertProjection, DbProjection, InsertRecommendation, DbRecommendation,
  InsertTeamDefense, DbTeamDefense, TrackRecord,
  InsertSportsbook, DbSportsbook, InsertPlayerPropLine, DbPlayerPropLine,
  InsertLineMovement, DbLineMovement, DbBestLine,
  InsertUserBet, DbUserBet, LineComparison,
  InsertPlayerOnOffSplit, DbPlayerOnOffSplit,
  InsertParlay, DbParlay, InsertParlayPick, DbParlayPick,
  Alert, InsertAlert
} from "@shared/schema";

// Re-export individual storage modules
export * from "./player-storage";
export * from "./bet-storage";
export * from "./prizepicks-storage";
export * from "./base";

// Import the full storage implementation for backward compatibility
import { DatabaseStorage, MemStorage } from "./legacy-storage";

// Export the storage interface for type compatibility
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
  syncPlayers(data: InsertPlayer[]): Promise<void>;

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

  // PrizePicks Historical Data
  getPrizePicksDailyLines(date: Date): Promise<Array<{
    playerName: string;
    team: string;
    statType: string;
    openingLine: number;
    closingLine?: number;
    netMovement: number;
    numMovements: number;
    gameTime: Date;
  }>>;
  getPrizePicksLineHistoryRange(startDate: Date, endDate: Date): Promise<any[]>;
  getRecentPrizePicksMovements(limit?: number): Promise<Array<{
    playerName: string;
    statType: string;
    oldLine: number;
    newLine: number;
    lineChange: number;
    direction: string;
    isSignificant: boolean;
    detectedAt: Date;
  }>>;
  getPlayerLineTrend(playerName: string, statType: string, days?: number): Promise<Array<{
    gameDate: string;
    openingLine: number;
    closingLine?: number;
    actualValue?: number;
    hitOver?: boolean;
  }>>;
  getPrizePicksAvailableDates(limit?: number): Promise<string[]>;
}

// Export the storage instance (uses database if available, otherwise memory)
export const storage: IStorage = process.env.DATABASE_URL
  ? new DatabaseStorage()
  : new MemStorage();

// Re-export classes for direct usage if needed
export { DatabaseStorage, MemStorage };
