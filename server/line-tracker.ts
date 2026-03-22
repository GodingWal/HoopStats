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
import { fetchNbaEvents, isOddsApiConfigured, type OddsEvent } from "./odds-api";
import { apiCache } from "./cache";
import { apiLogger } from "./logger";

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

  // Map TheOddsAPI market keys to our stat type labels
  private static MARKET_TO_STAT: Record<string, string> = {
    player_points: "PTS",
    player_rebounds: "REB",
    player_assists: "AST",
    player_threes: "FG3M",
    player_blocks: "BLK",
    player_steals: "STL",
    player_points_rebounds_assists: "PRA",
  };

  /**
   * Fetch lines from TheOddsAPI player props endpoints
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
    if (!isOddsApiConfigured()) {
      apiLogger.debug("LineTracker: Odds API not configured, skipping");
      return [];
    }

    const results: Array<{
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
    }> = [];

    try {
      const events = await fetchNbaEvents();
      if (events.length === 0) return [];

      // Build a player name → id/team lookup from storage
      const players = await storage.getPlayers();
      const playerLookup = new Map<string, { id: number; team: string }>();
      for (const p of players) {
        playerLookup.set(p.player_name.toLowerCase(), { id: p.player_id, team: p.team });
      }

      const apiKey = process.env.THE_ODDS_API_KEY;
      if (!apiKey) return [];

      const PLAYER_PROP_MARKETS = [
        "player_points", "player_rebounds", "player_assists",
        "player_threes", "player_blocks", "player_steals",
        "player_points_rebounds_assists",
      ].join(",");

      const BOOKMAKERS = ["draftkings", "fanduel", "betmgm", "caesars", "pointsbetus"].join(",");

      // Fetch player props for each event (limit to conserve API credits)
      for (const event of events.slice(0, 8)) {
        const cacheKey = `line-tracker-props-${event.id}`;
        let rawData = apiCache.get<any>(cacheKey);

        if (!rawData) {
          try {
            const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=${PLAYER_PROP_MARKETS}&oddsFormat=american&bookmakers=${BOOKMAKERS}`;
            const response = await fetch(url);
            if (!response.ok) {
              if (response.status === 404) continue;
              apiLogger.warn(`LineTracker: Failed to fetch props for event ${event.id}: ${response.status}`);
              continue;
            }
            rawData = await response.json();
            apiCache.set(cacheKey, rawData, 5 * 60 * 1000);
          } catch (err) {
            apiLogger.error(`LineTracker: Error fetching event ${event.id}`, err);
            continue;
          }
        }

        const gameDate = event.commence_time.split("T")[0];
        const homeTeam = event.home_team;
        const awayTeam = event.away_team;

        for (const bookmaker of rawData.bookmakers || []) {
          for (const market of bookmaker.markets || []) {
            const stat = LineTracker.MARKET_TO_STAT[market.key];
            if (!stat) continue;

            // Group outcomes by player name (description field)
            const playerOutcomes = new Map<string, { over?: { price: number; point: number }; under?: { price: number; point: number } }>();

            for (const outcome of market.outcomes || []) {
              const playerName = outcome.description;
              if (!playerName) continue;

              if (!playerOutcomes.has(playerName)) {
                playerOutcomes.set(playerName, {});
              }
              const entry = playerOutcomes.get(playerName)!;
              const side = outcome.name?.toLowerCase();
              if (side === "over") {
                entry.over = { price: outcome.price, point: outcome.point ?? 0 };
              } else if (side === "under") {
                entry.under = { price: outcome.price, point: outcome.point ?? 0 };
              }
            }

            for (const [playerName, sides] of playerOutcomes) {
              if (!sides.over || !sides.under) continue;

              const lookup = playerLookup.get(playerName.toLowerCase());
              // Determine opponent based on which team the player is on
              const playerTeam = lookup?.team || "";
              const opponent = playerTeam === homeTeam ? awayTeam : homeTeam;

              results.push({
                playerId: lookup?.id || 0,
                playerName,
                team: playerTeam,
                gameId: event.id,
                gameDate,
                opponent,
                stat,
                sportsbookKey: bookmaker.key,
                sportsbookName: bookmaker.title,
                line: sides.over.point,
                overOdds: sides.over.price,
                underOdds: sides.under.price,
              });
            }
          }
        }
      }
    } catch (error) {
      apiLogger.error("LineTracker: Error in fetchLinesFromOddsAPI", error);
    }

    return results;
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
