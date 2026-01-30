/**
 * On/Off Splits Service
 *
 * Orchestrates calculation of teammate performance splits when star players sit.
 * Manages calculation queue, caching, and Python script execution.
 */

import { spawn } from "child_process";
import path from "path";
import { apiLogger } from "./logger";
import { storage } from "./storage";
import type { DbPlayerOnOffSplit, InsertPlayerOnOffSplit, Player } from "@shared/schema";

// ========================================
// TYPES
// ========================================

interface CacheEntry {
  data: DbPlayerOnOffSplit[];
  timestamp: Date;
}

interface CalculationResult {
  star_player: {
    id: number;
    name: string;
    team: string;
  };
  teammates: Array<{
    player_id: number;
    player_name: string;
    season: string;
    team: string;
    games_with: number;
    games_without: number;
    pts_with: number | null;
    pts_without: number;
    pts_delta: number | null;
    reb_with: number | null;
    reb_without: number;
    reb_delta: number | null;
    ast_with: number | null;
    ast_without: number;
    ast_delta: number | null;
    min_with: number | null;
    min_without: number;
    min_delta: number | null;
    fga_with: number | null;
    fga_without: number;
    fga_delta: number | null;
  }>;
}

// ========================================
// SERVICE CLASS
// ========================================

export class OnOffSplitsService {
  private calculationQueue: Map<number, Promise<void>>;
  private cache: Map<string, CacheEntry>;
  private cacheValidityMs: number = 60 * 60 * 1000; // 1 hour

  constructor() {
    this.calculationQueue = new Map();
    this.cache = new Map();
    apiLogger.info("OnOffSplitsService initialized");
  }

  /**
   * Calculate splits for a player (triggered when injury detected)
   */
  async calculateSplitsForPlayer(
    playerId: number,
    playerName: string,
    team: string,
    seasons: string[] = ["2024-25", "2023-24"]
  ): Promise<void> {
    // Check if already calculating
    if (this.calculationQueue.has(playerId)) {
      apiLogger.info(`Calculation already in progress for player ${playerId}`);
      return this.calculationQueue.get(playerId)!;
    }

    // Check cache validity
    if (this.isCacheValid(playerId)) {
      apiLogger.info(`Using cached splits for player ${playerId}`);
      return;
    }

    // Start calculation
    const calculationPromise = this._executePythonCalculation(
      playerId,
      playerName,
      team,
      seasons
    );

    this.calculationQueue.set(playerId, calculationPromise);

    try {
      await calculationPromise;
    } finally {
      this.calculationQueue.delete(playerId);
    }
  }

  /**
   * Get splits for a player (from database)
   */
  async getSplitsForPlayer(
    playerId: number,
    season?: string
  ): Promise<DbPlayerOnOffSplit[]> {
    return await storage.getPlayerOnOffSplits(playerId, season);
  }

  /**
   * Get top beneficiaries when a player sits
   */
  async getTopBeneficiaries(
    playerId: number,
    stat: 'pts' | 'reb' | 'ast',
    limit: number = 5
  ): Promise<DbPlayerOnOffSplit[]> {
    return await storage.getTopBeneficiaries(playerId, stat, limit);
  }

  /**
   * Get all splits for a team
   */
  async getTeamSplits(
    teamAbbr: string,
    season?: string
  ): Promise<DbPlayerOnOffSplit[]> {
    return await storage.getOnOffSplitsByTeam(teamAbbr, season);
  }

  /**
   * Clear stale splits data
   */
  async clearStaleData(olderThanDays: number = 30): Promise<void> {
    await storage.deleteStaleOnOffSplits(olderThanDays);
    apiLogger.info(`Cleared splits older than ${olderThanDays} days`);
  }

  // ========================================
  // PRIVATE METHODS
  // ========================================

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(playerId: number): boolean {
    const cacheKey = `player_${playerId}`;
    const cached = this.cache.get(cacheKey);

    if (!cached) {
      return false;
    }

    const age = Date.now() - cached.timestamp.getTime();
    return age < this.cacheValidityMs;
  }

  /**
   * Execute Python calculation script
   */
  private async _executePythonCalculation(
    playerId: number,
    playerName: string,
    team: string,
    seasons: string[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      apiLogger.info(
        `Starting on/off splits calculation for ${playerName} (${playerId}) - ${team}`
      );

      const scriptPath = path.join(
        process.cwd(),
        "server",
        "nba-prop-model",
        "src",
        "data",
        "on_off_calculator.py"
      );

      // Build command arguments
      const args = [
        scriptPath,
        "--player-id",
        playerId.toString(),
        "--team",
        team,
        "--seasons",
        ...seasons,
      ];

      // Use venv python on Linux (production), fallback to 'python' on Windows (dev)
      const pythonCmd = process.platform === 'win32'
        ? 'python'
        : path.join(process.cwd(), '.venv', 'bin', 'python');

      const pythonProcess = spawn(pythonCmd, args);

      let dataString = "";
      let errorString = "";

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", async (code) => {
        if (code !== 0) {
          apiLogger.error("Python calculation failed", {
            playerId,
            error: errorString,
            code,
          });
          reject(new Error(`Python script failed with code ${code}: ${errorString}`));
          return;
        }

        try {
          // Parse output
          const result: CalculationResult = JSON.parse(dataString);

          // Save to database
          for (const teammate of result.teammates) {
            const splitData: InsertPlayerOnOffSplit = {
              playerId: teammate.player_id,
              playerName: teammate.player_name,
              team: teammate.team,
              withoutPlayerId: result.star_player.id,
              withoutPlayerName: result.star_player.name,
              season: teammate.season,
              gamesWithTeammate: teammate.games_with,
              gamesWithoutTeammate: teammate.games_without,
              ptsWithTeammate: teammate.pts_with,
              rebWithTeammate: teammate.reb_with,
              astWithTeammate: teammate.ast_with,
              minWithTeammate: teammate.min_with,
              fgaWithTeammate: teammate.fga_with,
              ptsWithoutTeammate: teammate.pts_without,
              rebWithoutTeammate: teammate.reb_without,
              astWithoutTeammate: teammate.ast_without,
              minWithoutTeammate: teammate.min_without,
              fgaWithoutTeammate: teammate.fga_without,
              ptsDelta: teammate.pts_delta,
              rebDelta: teammate.reb_delta,
              astDelta: teammate.ast_delta,
              minDelta: teammate.min_delta,
              fgaDelta: teammate.fga_delta,
            };

            await storage.savePlayerOnOffSplit(splitData);
          }

          apiLogger.info(
            `Saved ${result.teammates.length} teammate splits for ${playerName}`
          );

          // Update cache
          const cacheKey = `player_${playerId}`;
          this.cache.set(cacheKey, {
            data: await storage.getPlayerOnOffSplits(playerId),
            timestamp: new Date(),
          });

          resolve();
        } catch (error) {
          apiLogger.error("Failed to parse/save calculation results", { error });
          reject(error);
        }
      });

      pythonProcess.on("error", (error) => {
        apiLogger.error("Failed to spawn Python process", { error });
        reject(error);
      });
    });
  }

  /**
   * Fallback: compute approximate on/off splits from game log data in the DB.
   * Cross-references the injured player's game dates with teammates' game dates
   * to identify games played with vs without the injured player.
   */
  async computeSplitsFromGameLogs(
    playerId: number,
    playerName: string,
    team: string
  ): Promise<DbPlayerOnOffSplit[]> {
    apiLogger.info(`Computing fallback splits from game logs for ${playerName} (${team})`);

    const allPlayers = await storage.getPlayers();
    const teammates = allPlayers.filter(
      (p) => p.team === team && p.player_id !== playerId
    );
    const injuredPlayer = allPlayers.find((p) => p.player_id === playerId);

    if (!injuredPlayer || !injuredPlayer.recent_games || injuredPlayer.recent_games.length === 0) {
      apiLogger.warn(`No game log data found for player ${playerId}`);
      return [];
    }

    // Build a set of dates the injured player actually played
    const injuredPlayerDates = new Set(
      injuredPlayer.recent_games.map((g) => g.GAME_DATE)
    );

    const results: DbPlayerOnOffSplit[] = [];
    let idCounter = -1; // Negative IDs to distinguish from DB records

    for (const teammate of teammates) {
      if (!teammate.recent_games || teammate.recent_games.length === 0) continue;

      const gamesWith: typeof teammate.recent_games = [];
      const gamesWithout: typeof teammate.recent_games = [];

      for (const game of teammate.recent_games) {
        if (injuredPlayerDates.has(game.GAME_DATE)) {
          gamesWith.push(game);
        } else {
          gamesWithout.push(game);
        }
      }

      // Need at least 2 games without to be meaningful
      if (gamesWithout.length < 2) continue;

      const avg = (games: typeof teammate.recent_games, field: 'PTS' | 'REB' | 'AST' | 'MIN' | 'FG3M') => {
        if (games.length === 0) return 0;
        return games.reduce((sum, g) => sum + (g[field] ?? 0), 0) / games.length;
      };

      const ptsWith = gamesWith.length > 0 ? avg(gamesWith, 'PTS') : null;
      const rebWith = gamesWith.length > 0 ? avg(gamesWith, 'REB') : null;
      const astWith = gamesWith.length > 0 ? avg(gamesWith, 'AST') : null;
      const minWith = gamesWith.length > 0 ? avg(gamesWith, 'MIN') : null;
      const fgaWith = gamesWith.length > 0 ? avg(gamesWith, 'FG3M') : null; // FG3M as proxy for FGA

      const ptsWithout = avg(gamesWithout, 'PTS');
      const rebWithout = avg(gamesWithout, 'REB');
      const astWithout = avg(gamesWithout, 'AST');
      const minWithout = avg(gamesWithout, 'MIN');
      const fgaWithout = avg(gamesWithout, 'FG3M');

      const ptsDelta = ptsWith !== null ? ptsWithout - ptsWith : null;
      const rebDelta = rebWith !== null ? rebWithout - rebWith : null;
      const astDelta = astWith !== null ? astWithout - astWith : null;
      const minDelta = minWith !== null ? minWithout - minWith : null;
      const fgaDelta = fgaWith !== null ? fgaWithout - fgaWith : null;

      const split: DbPlayerOnOffSplit = {
        id: idCounter--,
        playerId: teammate.player_id,
        playerName: teammate.player_name,
        team: teammate.team,
        withoutPlayerId: playerId,
        withoutPlayerName: playerName,
        season: "2024-25",
        gamesWithTeammate: gamesWith.length,
        gamesWithoutTeammate: gamesWithout.length,
        ptsWithTeammate: ptsWith !== null ? Math.round(ptsWith * 10) / 10 : null,
        rebWithTeammate: rebWith !== null ? Math.round(rebWith * 10) / 10 : null,
        astWithTeammate: astWith !== null ? Math.round(astWith * 10) / 10 : null,
        minWithTeammate: minWith !== null ? Math.round(minWith * 10) / 10 : null,
        fgaWithTeammate: fgaWith !== null ? Math.round(fgaWith * 10) / 10 : null,
        ptsWithoutTeammate: Math.round(ptsWithout * 10) / 10,
        rebWithoutTeammate: Math.round(rebWithout * 10) / 10,
        astWithoutTeammate: Math.round(astWithout * 10) / 10,
        minWithoutTeammate: Math.round(minWithout * 10) / 10,
        fgaWithoutTeammate: Math.round(fgaWithout * 10) / 10,
        ptsDelta: ptsDelta !== null ? Math.round(ptsDelta * 10) / 10 : null,
        rebDelta: rebDelta !== null ? Math.round(rebDelta * 10) / 10 : null,
        astDelta: astDelta !== null ? Math.round(astDelta * 10) / 10 : null,
        minDelta: minDelta !== null ? Math.round(minDelta * 10) / 10 : null,
        fgaDelta: fgaDelta !== null ? Math.round(fgaDelta * 10) / 10 : null,
        calculatedAt: new Date(),
        updatedAt: new Date(),
      };

      results.push(split);

      // Also save to storage for future lookups
      try {
        await storage.savePlayerOnOffSplit({
          playerId: teammate.player_id,
          playerName: teammate.player_name,
          team: teammate.team,
          withoutPlayerId: playerId,
          withoutPlayerName: playerName,
          season: "2024-25",
          gamesWithTeammate: gamesWith.length,
          gamesWithoutTeammate: gamesWithout.length,
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
        });
      } catch (saveErr) {
        // Non-fatal: splits are still returned even if save fails
        apiLogger.warn(`Failed to persist fallback split for ${teammate.player_name}`, { saveErr });
      }
    }

    apiLogger.info(`Computed ${results.length} fallback splits for ${playerName}`);
    return results;
  }
}

// ========================================
// SINGLETON INSTANCE
// ========================================

export const onOffService = new OnOffSplitsService();
