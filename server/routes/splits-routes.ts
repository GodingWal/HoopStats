import type { Express } from "express";
import { pool } from "../db";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { onOffService } from "../on-off-service";

export function registerSplitsRoutes(app: Express): void {
  app.get("/api/splits/without-player/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { season } = req.query;

      if (!playerId) {
        return res.status(400).json({ error: "Player ID is required" });
      }

      let splits = await onOffService.getSplitsForPlayer(
        parseInt(playerId),
        season as string | undefined
      );

      // Auto-calculate if no data found
      if (splits.length === 0) {
        const player = await storage.getPlayer(parseInt(playerId));
        const playerName = player?.player_name || req.query.playerName as string;
        const team = player?.team || req.query.team as string;

        if (playerName && team) {
          // Try Python calculator first
          try {
            apiLogger.info(`No splits found for ${playerName}. Auto-calculating via Python...`);
            await onOffService.calculateSplitsForPlayer(
              parseInt(playerId),
              playerName,
              team
            );
            splits = await onOffService.getSplitsForPlayer(
              parseInt(playerId),
              season as string | undefined
            );
          } catch (calcError) {
            apiLogger.warn("Python auto-calculation failed, trying game-log fallback:", { error: calcError });
          }

          // Fallback: compute from game log data already in DB
          if (splits.length === 0) {
            try {
              apiLogger.info(`Computing fallback splits from game logs for ${playerName}...`);
              splits = await onOffService.computeSplitsFromGameLogs(
                parseInt(playerId),
                playerName,
                team
              );
            } catch (fallbackError) {
              apiLogger.error("Game-log fallback calculation also failed:", fallbackError);
            }
          }
        } else {
          apiLogger.info(`Cannot auto-calculate splits: Player ${playerId} not in DB and no playerName/team provided in query`);
        }
      }

      // Filter out entries with insufficient sample size (at least 2 games without)
      const validSplits = splits.filter(s => s.gamesWithoutTeammate >= 2);

      // Sort by points delta descending (biggest beneficiaries first)
      const sortedSplits = validSplits.sort((a, b) => {
        const aDelta = a.ptsDelta ?? 0;
        const bDelta = b.ptsDelta ?? 0;
        return bDelta - aDelta;
      });

      res.json({
        playerId: parseInt(playerId),
        splits: sortedSplits,
        count: sortedSplits.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching on/off splits:", error);
      res.status(500).json({ error: "Failed to fetch on/off splits" });
    }
  });

  // Get top beneficiaries by stat
  app.get("/api/splits/biggest-beneficiaries/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { stat = 'pts', limit = '5' } = req.query;

      if (!playerId) {
        return res.status(400).json({ error: "Player ID is required" });
      }

      if (!['pts', 'reb', 'ast'].includes(stat as string)) {
        return res.status(400).json({ error: "Stat must be pts, reb, or ast" });
      }

      const beneficiaries = await onOffService.getTopBeneficiaries(
        parseInt(playerId),
        stat as 'pts' | 'reb' | 'ast',
        parseInt(limit as string)
      );

      res.json({
        playerId: parseInt(playerId),
        stat,
        beneficiaries,
        count: beneficiaries.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching top beneficiaries:", error);
      res.status(500).json({ error: "Failed to fetch top beneficiaries" });
    }
  });

  // Manually trigger calculation for a player
  app.post("/api/splits/calculate/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { playerName, team, seasons } = req.body;

      if (!playerId || !playerName || !team) {
        return res.status(400).json({
          error: "Player ID, player name, and team are required",
        });
      }

      // Start calculation in background
      onOffService.calculateSplitsForPlayer(
        parseInt(playerId),
        playerName,
        team,
        seasons
      ).catch(error => {
        apiLogger.error("Background calculation failed:", error);
      });

      res.json({
        message: "Calculation started",
        playerId: parseInt(playerId),
        playerName,
        status: "processing",
      });
    } catch (error) {
      apiLogger.error("Error triggering calculation:", error);
      res.status(500).json({ error: "Failed to start calculation" });
    }
  });

  // Get team-wide splits
  app.get("/api/splits/team/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      const { season } = req.query;

      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const splits = await onOffService.getTeamSplits(
        teamAbbr.toUpperCase(),
        season as string | undefined
      );

      // Group by injured player
      const groupedByInjuredPlayer = splits.reduce((acc, split) => {
        const key = split.withoutPlayerId;
        if (!acc[key]) {
          acc[key] = {
            injuredPlayerId: split.withoutPlayerId,
            injuredPlayerName: split.withoutPlayerName,
            teammates: [],
          };
        }
        acc[key].teammates.push(split);
        return acc;
      }, {} as Record<number, {
        injuredPlayerId: number;
        injuredPlayerName: string;
        teammates: typeof splits;
      }>);

      res.json({
        teamAbbr: teamAbbr.toUpperCase(),
        season,
        injuredPlayers: Object.values(groupedByInjuredPlayer),
        totalSplits: splits.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching team splits:", error);
      res.status(500).json({ error: "Failed to fetch team splits" });
    }
  });

  // =============== TEAM STATS ROUTES ===============

  // Get all NBA teams list
}
