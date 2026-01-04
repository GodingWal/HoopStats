/**
 * Line Tracking Service
 *
 * Automatically polls sportsbooks for player prop lines and stores all data:
 * - Captures lines from multiple sportsbooks
 * - Detects line movements
 * - Calculates implied probabilities and vig
 * - Updates best available lines
 * - Triggers alerts for significant movements
 */

import { storage } from "./storage";
import type { InsertPlayerPropLine, InsertLineMovement, DbPlayerPropLine } from "@shared/schema";
import { EventEmitter } from "events";

// Helper: Convert American odds to implied probability
function americanToProb(odds: number): number {
  if (odds > 0) {
    return 100 / (odds + 100);
  } else {
    return Math.abs(odds) / (Math.abs(odds) + 100);
  }
}

// Helper: Calculate vig from probabilities
function calculateVig(overProb: number, underProb: number): number {
  const totalProb = overProb + underProb;
  return (totalProb - 1) / 2;
}

interface LineSnapshot {
  playerId: number;
  stat: string;
  sportsbookKey: string;
  line: number;
  overOdds: number;
  underOdds: number;
  timestamp: Date;
}

export class LineTracker extends EventEmitter {
  private isRunning: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastLines: Map<string, LineSnapshot> = new Map();

  constructor() {
    super();
  }

  /**
   * Start tracking lines
   */
  start(intervalMs: number = 300000): void { // Default: 5 minutes
    if (this.isRunning) {
      console.log("Line tracker already running");
      return;
    }

    console.log(`Starting line tracker (polling every ${intervalMs/1000}s)...`);
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
    console.log("Line tracker stopped");
  }

  /**
   * Poll all sportsbooks for current lines
   */
  private async pollLines(): Promise<void> {
    try {
      console.log(`[${new Date().toISOString()}] Polling lines...`);

      // Get today's games from odds API
      const todayLines = await this.fetchLinesFromOddsAPI();

      // Process each line
      for (const line of todayLines) {
        await this.processLine(line);
      }

      console.log(`Processed ${todayLines.length} lines`);
    } catch (error) {
      console.error("Error polling lines:", error);
    }
  }

  /**
   * Fetch lines from TheOddsAPI or other odds providers
   */
  private async fetchLinesFromOddsAPI(): Promise<Array<{
    playerId: number;
    playerName: string;
    team: string;
    gameId: string;
    gameDate: string;
    opponent: string;
    stat: string;
    sportsbookKey: string;
    sportsbookName: string;
    line: number;
    overOdds: number;
    underOdds: number;
  }>> {
    // TODO: Implement actual odds API fetching
    // This would call your existing odds-api.ts functions
    // and transform the data into the format needed

    // For now, return empty array
    // In production, this would fetch from:
    // - TheOddsAPI player props endpoint
    // - DraftKings/FanDuel APIs
    // - PrizePicks data
    // etc.

    return [];
  }

  /**
   * Process a single line: store it, detect movements, update best lines
   */
  private async processLine(lineData: {
    playerId: number;
    playerName: string;
    team: string;
    gameId: string;
    gameDate: string;
    opponent: string;
    stat: string;
    sportsbookKey: string;
    sportsbookName: string;
    line: number;
    overOdds: number;
    underOdds: number;
  }): Promise<void> {
    // Calculate implied probabilities
    const overProb = americanToProb(lineData.overOdds);
    const underProb = americanToProb(lineData.underOdds);
    const totalProb = overProb + underProb;
    const vig = calculateVig(overProb, underProb);

    // Get sportsbook ID (create if doesn't exist)
    const sportsbook = await storage.upsertSportsbook({
      key: lineData.sportsbookKey,
      name: lineData.sportsbookName,
      active: true,
      lastSync: new Date(),
    });

    // Save the line
    const savedLine = await storage.savePlayerPropLine({
      playerId: lineData.playerId,
      playerName: lineData.playerName,
      team: lineData.team,
      gameId: lineData.gameId,
      gameDate: lineData.gameDate,
      opponent: lineData.opponent,
      stat: lineData.stat,
      line: lineData.line,
      sportsbookId: sportsbook.id,
      sportsbookKey: lineData.sportsbookKey,
      overOdds: lineData.overOdds,
      underOdds: lineData.underOdds,
      overProb,
      underProb,
      totalProb,
      vig,
      isActive: true,
    });

    // Check for line movement
    const lineKey = `${lineData.playerId}-${lineData.stat}-${lineData.sportsbookKey}`;
    const previousLine = this.lastLines.get(lineKey);

    if (previousLine) {
      await this.detectLineMovement(previousLine, {
        playerId: lineData.playerId,
        stat: lineData.stat,
        sportsbookKey: lineData.sportsbookKey,
        line: lineData.line,
        overOdds: lineData.overOdds,
        underOdds: lineData.underOdds,
        timestamp: new Date(),
      }, lineData.playerName, lineData.gameId, lineData.gameDate);
    }

    // Update last known line
    this.lastLines.set(lineKey, {
      playerId: lineData.playerId,
      stat: lineData.stat,
      sportsbookKey: lineData.sportsbookKey,
      line: lineData.line,
      overOdds: lineData.overOdds,
      underOdds: lineData.underOdds,
      timestamp: new Date(),
    });

    // Update best lines aggregate
    await storage.updateBestLines(lineData.playerId, lineData.stat, lineData.gameDate);
  }

  /**
   * Detect and record line movement
   */
  private async detectLineMovement(
    oldLine: LineSnapshot,
    newLine: LineSnapshot,
    playerName: string,
    gameId: string,
    gameDate: string
  ): Promise<void> {
    const lineChange = newLine.line - oldLine.line;
    const magnitude = Math.abs(lineChange);

    // Determine if movement is significant
    const lineMovedSignificantly = magnitude >= 0.5;
    const oddsChangedSignificantly =
      Math.abs(newLine.overOdds - oldLine.overOdds) >= 20 ||
      Math.abs(newLine.underOdds - oldLine.underOdds) >= 20;

    const isSignificant = lineMovedSignificantly || oddsChangedSignificantly;

    // Determine direction
    let direction: 'up' | 'down' | 'odds_only';
    if (lineChange > 0) {
      direction = 'up';
    } else if (lineChange < 0) {
      direction = 'down';
    } else {
      direction = 'odds_only';
    }

    // Save movement
    const movement = await storage.saveLineMovement({
      playerId: newLine.playerId,
      playerName,
      gameId,
      stat: newLine.stat,
      sportsbookKey: newLine.sportsbookKey,
      oldLine: oldLine.line,
      newLine: newLine.line,
      lineChange,
      oldOverOdds: oldLine.overOdds,
      newOverOdds: newLine.overOdds,
      oldUnderOdds: oldLine.underOdds,
      newUnderOdds: newLine.underOdds,
      direction,
      magnitude,
      isSignificant,
      gameDate,
    });

    // Emit event for significant movements
    if (isSignificant) {
      this.emit('significant-movement', {
        movement,
        oldLine,
        newLine,
        playerName,
      });

      console.log(`📈 Significant line movement: ${playerName} ${newLine.stat} moved from ${oldLine.line} to ${newLine.line} at ${newLine.sportsbookKey}`);
    }
  }

  /**
   * Manually trigger a poll (useful for testing)
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
    lastPoll: Date | null;
  } {
    return {
      isRunning: this.isRunning,
      trackedLines: this.lastLines.size,
      lastPoll: null, // Could add timestamp tracking
    };
  }

  /**
   * Clear tracking history (useful for testing/debugging)
   */
  clearHistory(): void {
    this.lastLines.clear();
    console.log("Line tracking history cleared");
  }
}

// Export singleton instance
export const lineTracker = new LineTracker();

// Event listeners can be added like:
// lineTracker.on('significant-movement', (data) => {
//   console.log('Line moved:', data);
//   // Send alert, update dashboard, etc.
// });

// Usage:
// import { lineTracker } from './server/line-tracker';
// lineTracker.start(300000); // Poll every 5 minutes
