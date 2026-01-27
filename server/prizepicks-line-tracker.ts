/**
 * PrizePicks Line Tracking Service
 *
 * Automatically polls PrizePicks for player prop lines and stores all data:
 * - Captures every line snapshot for historical analysis
 * - Detects line movements
 * - Tracks opening and closing lines
 * - Provides APIs for querying historical line data
 */

import { EventEmitter } from "events";
import { fetchPrizePicksProjections, type PrizePicksProjection } from "./prizepicks-api";
import { apiLogger } from "./logger";

// In-memory storage for last known lines (for movement detection)
interface LineSnapshot {
  prizePicksId: string;
  prizePicksPlayerId: string;
  playerName: string;
  statType: string;
  line: number;
  gameTime: string;
  capturedAt: Date;
}

export interface PrizePicksLineData {
  prizePicksId: string;
  prizePicksPlayerId: string;
  playerName: string;
  team: string;
  teamAbbr: string;
  position: string;
  statType: string;
  statTypeAbbr: string;
  line: number;
  gameTime: string;
  opponent: string;
  imageUrl?: string;
}

export interface PrizePicksMovement {
  prizePicksPlayerId: string;
  playerName: string;
  statType: string;
  statTypeAbbr: string;
  gameTime: string;
  opponent: string;
  oldLine: number;
  newLine: number;
  lineChange: number;
  direction: 'up' | 'down';
  magnitude: number;
  isSignificant: boolean;
}

export class PrizePicksLineTracker extends EventEmitter {
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastLines: Map<string, LineSnapshot> = new Map();
  private pollCount: number = 0;
  private lastPollTime: Date | null = null;
  private lastError: string | null = null;

  // Storage interface - will be injected
  private storage: PrizePicksLineStorage | null = null;

  constructor() {
    super();
  }

  /**
   * Set the storage implementation
   */
  setStorage(storage: PrizePicksLineStorage): void {
    this.storage = storage;
  }

  /**
   * Start tracking PrizePicks lines
   * @param intervalMs - Polling interval in milliseconds (default: 5 minutes)
   */
  start(intervalMs: number = 300000): void {
    if (this.isRunning) {
      apiLogger.info("PrizePicks line tracker already running");
      return;
    }

    apiLogger.info(`Starting PrizePicks line tracker (polling every ${intervalMs / 1000}s)...`);
    this.isRunning = true;

    // Poll immediately
    this.pollLines();

    // Then poll on interval
    this.pollInterval = setInterval(() => {
      this.pollLines();
    }, intervalMs);
  }

  /**
   * Stop tracking lines
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isRunning = false;
    apiLogger.info("PrizePicks line tracker stopped");
  }

  /**
   * Poll PrizePicks for current lines
   */
  private async pollLines(): Promise<void> {
    const startTime = Date.now();

    try {
      apiLogger.info(`[PrizePicks Tracker] Polling lines... (poll #${this.pollCount + 1})`);

      const projections = await fetchPrizePicksProjections();

      if (!projections || projections.length === 0) {
        apiLogger.warn("[PrizePicks Tracker] No projections returned from API");
        return;
      }

      let newLinesCount = 0;
      let movementsCount = 0;
      let significantMovements = 0;

      for (const proj of projections) {
        const lineData = this.transformProjection(proj);
        const movement = await this.processLine(lineData);

        if (movement) {
          movementsCount++;
          if (movement.isSignificant) {
            significantMovements++;
          }
        } else {
          newLinesCount++;
        }
      }

      this.pollCount++;
      this.lastPollTime = new Date();
      this.lastError = null;

      const elapsed = Date.now() - startTime;
      apiLogger.info(
        `[PrizePicks Tracker] Poll complete in ${elapsed}ms: ` +
        `${projections.length} lines, ${newLinesCount} new, ` +
        `${movementsCount} movements (${significantMovements} significant)`
      );

    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      apiLogger.error("[PrizePicks Tracker] Error polling lines:", error);
      this.emit('error', error);
    }
  }

  /**
   * Transform a PrizePicks projection into our internal format
   */
  private transformProjection(proj: PrizePicksProjection): PrizePicksLineData {
    return {
      prizePicksId: proj.id,
      prizePicksPlayerId: proj.playerId,
      playerName: proj.playerName,
      team: proj.team,
      teamAbbr: proj.teamAbbr,
      position: proj.position,
      statType: proj.statType,
      statTypeAbbr: proj.statTypeAbbr,
      line: proj.line,
      gameTime: proj.gameTime,
      opponent: proj.opponent,
      imageUrl: proj.imageUrl,
    };
  }

  /**
   * Process a single line: store it and detect movements
   * Returns the movement if one was detected, null for new lines
   */
  private async processLine(lineData: PrizePicksLineData): Promise<PrizePicksMovement | null> {
    // Create unique key for this player/stat combination
    const lineKey = `${lineData.prizePicksPlayerId}-${lineData.statType}-${lineData.gameTime}`;
    const previousLine = this.lastLines.get(lineKey);

    // Save to storage if available
    if (this.storage) {
      try {
        await this.storage.savePrizePicksLine({
          prizePicksId: lineData.prizePicksId,
          prizePicksPlayerId: lineData.prizePicksPlayerId,
          playerName: lineData.playerName,
          team: lineData.team,
          teamAbbr: lineData.teamAbbr,
          position: lineData.position,
          gameTime: new Date(lineData.gameTime),
          opponent: lineData.opponent,
          statType: lineData.statType,
          statTypeAbbr: lineData.statTypeAbbr,
          line: lineData.line,
          imageUrl: lineData.imageUrl,
          isActive: true,
        });
      } catch (dbError) {
        // Log but don't crash - database schema issues shouldn't kill the server
        apiLogger.warn(`[PrizePicks Tracker] Failed to save line for ${lineData.playerName}: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }
    }

    let movement: PrizePicksMovement | null = null;

    // Check for line movement
    if (previousLine && previousLine.line !== lineData.line) {
      movement = this.detectMovement(previousLine, lineData);

      // Save movement to storage
      if (this.storage && movement) {
        try {
          await this.storage.savePrizePicksLineMovement({
            prizePicksPlayerId: movement.prizePicksPlayerId,
            playerName: movement.playerName,
            statType: movement.statType,
            statTypeAbbr: movement.statTypeAbbr,
            gameTime: new Date(movement.gameTime),
            opponent: movement.opponent,
            oldLine: movement.oldLine,
            newLine: movement.newLine,
            lineChange: movement.lineChange,
            direction: movement.direction,
            magnitude: movement.magnitude,
            isSignificant: movement.isSignificant,
          });
        } catch (dbError) {
          // Log but don't crash
          apiLogger.warn(`[PrizePicks Tracker] Failed to save movement for ${movement.playerName}: ${dbError instanceof Error ? dbError.message : String(dbError)}`);
        }
      }

      // Emit event for significant movements
      if (movement.isSignificant) {
        this.emit('significant-movement', movement);
        apiLogger.info(
          `[PrizePicks] Line movement: ${movement.playerName} ${movement.statType} ` +
          `${movement.oldLine} -> ${movement.newLine} (${movement.direction})`
        );
      }
    }

    // Update in-memory cache
    this.lastLines.set(lineKey, {
      prizePicksId: lineData.prizePicksId,
      prizePicksPlayerId: lineData.prizePicksPlayerId,
      playerName: lineData.playerName,
      statType: lineData.statType,
      line: lineData.line,
      gameTime: lineData.gameTime,
      capturedAt: new Date(),
    });

    return movement;
  }

  /**
   * Detect and create a movement record
   */
  private detectMovement(oldLine: LineSnapshot, newLineData: PrizePicksLineData): PrizePicksMovement {
    const lineChange = newLineData.line - oldLine.line;
    const magnitude = Math.abs(lineChange);
    const isSignificant = magnitude >= 0.5;
    const direction: 'up' | 'down' = lineChange > 0 ? 'up' : 'down';

    return {
      prizePicksPlayerId: newLineData.prizePicksPlayerId,
      playerName: newLineData.playerName,
      statType: newLineData.statType,
      statTypeAbbr: newLineData.statTypeAbbr,
      gameTime: newLineData.gameTime,
      opponent: newLineData.opponent,
      oldLine: oldLine.line,
      newLine: newLineData.line,
      lineChange,
      direction,
      magnitude,
      isSignificant,
    };
  }

  /**
   * Manually trigger a poll (useful for testing or on-demand refresh)
   */
  async pollNow(): Promise<void> {
    await this.pollLines();
  }

  /**
   * Get tracking stats
   */
  getStats(): {
    isRunning: boolean;
    trackedLines: number;
    pollCount: number;
    lastPollTime: Date | null;
    lastError: string | null;
  } {
    return {
      isRunning: this.isRunning,
      trackedLines: this.lastLines.size,
      pollCount: this.pollCount,
      lastPollTime: this.lastPollTime,
      lastError: this.lastError,
    };
  }

  /**
   * Get current in-memory lines (for quick access without DB)
   */
  getCurrentLines(): LineSnapshot[] {
    return Array.from(this.lastLines.values());
  }

  /**
   * Get current line for a specific player/stat
   */
  getCurrentLine(prizePicksPlayerId: string, statType: string, gameTime: string): LineSnapshot | undefined {
    const key = `${prizePicksPlayerId}-${statType}-${gameTime}`;
    return this.lastLines.get(key);
  }

  /**
   * Clear tracking history (useful for testing/debugging)
   */
  clearHistory(): void {
    this.lastLines.clear();
    this.pollCount = 0;
    this.lastPollTime = null;
    this.lastError = null;
    apiLogger.info("PrizePicks line tracking history cleared");
  }
}

/**
 * Storage interface for PrizePicks lines
 * Implemented by the database storage class
 */
export interface PrizePicksLineStorage {
  savePrizePicksLine(data: {
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
  }): Promise<void>;

  savePrizePicksLineMovement(data: {
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
  }): Promise<void>;

  getPrizePicksLineHistory(
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
  }>;

  getPrizePicksLinesByPlayer(playerName: string): Promise<Array<{
    statType: string;
    line: number;
    gameTime: Date;
    opponent?: string;
    capturedAt: Date;
  }>>;

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
}

// Export singleton instance
export const prizePicksLineTracker = new PrizePicksLineTracker();

// Usage example:
// import { prizePicksLineTracker } from './prizepicks-line-tracker';
// prizePicksLineTracker.setStorage(storage);
// prizePicksLineTracker.start(300000); // Poll every 5 minutes
//
// prizePicksLineTracker.on('significant-movement', (movement) => {
//   console.log('Line moved:', movement);
// });
