import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { generateBetExplanation } from "../services/openai";
import { fetchAndBuildAllPlayers } from "../nba-api";
import { generateBetsFromPrizePicks, ensurePlayersLoaded, enrichBetsWithCalibration } from "./route-helpers";

export function registerAdminRoutes(app: Express): void {
  app.post("/api/explain", async (req, res) => {
    try {
      const { player_name, prop, line, side, season_average, last_5_average, hit_rate, opponent } = req.body;

      if (!player_name || !prop || !line || !side) {
        return res.status(400).json({ error: "Missing required bet details" });
      }

      const explanation = await generateBetExplanation({
        player_name,
        prop,
        line,
        side,
        season_average: season_average || 0,
        last_5_average: last_5_average || 0,
        hit_rate: hit_rate || 0,
        opponent: opponent || "Unknown",
      });

      res.json({ explanation });
    } catch (error) {
      apiLogger.error("Error generating explanation:", error);
      res.status(500).json({ error: "Failed to generate explanation" });
    }
  });

  // Alerts API
  app.get("/api/alerts", async (req, res) => {
    try {
      const alerts = await storage.getAlerts({ limit: 20 });
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    try {
      await storage.markAlertAsRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark alert as read" });
    }
  });

  // Start background services
  // lineWatcher.start() is called in index.ts

  app.get("/api/sync/status", async (req, res) => {
    res.json({
      apiConfigured: true,
      message: "ESPN API is configured (Public). You can sync NBA data."
    });
  });

  app.post("/api/admin/sync-rosters", async (req, res) => {
    try {
      apiLogger.info("Starting NBA roster sync via ESPN...");

      const players = await fetchAndBuildAllPlayers((current, total) => {
        if (current % 50 === 0) {
          apiLogger.info(`Progress: ${current}/${total} players processed`);
        }
      });

      apiLogger.info(`Syncing ${players.length} players to database...`);

      // Clear existing players (sample data has different IDs than ESPN data)
      await storage.clearPlayers();

      // Use syncPlayers to upsert data (now effective seed since we cleared)
      await storage.syncPlayers(players);

      // Generate bets based on the new data
      // Note: bets generation might need players with ID, but syncPlayers updates DB.
      // We should fetch players from DB to get generated IDs if needed for bets?
      // PotentialBets schema has `player_id` (integer).
      // If `InsertPlayer` had `player_id` (external ID), usually we use that.
      // Schema: `potential_bets.player_id` is integer. `players.player_id` is integer (external).
      // So consistent usage of external ID is fine.
      // But `generatePotentialBets` takes `Player[]`. `players` here is `InsertPlayer[]`.
      // We should fetch fresh from DB to be safe and match types.

      const dbPlayers = await storage.getPlayers();

      // Generate bets from actual PrizePicks lines
      apiLogger.info("Fetching PrizePicks projections to sync bets...");
      const generatedBets = await generateBetsFromPrizePicks(dbPlayers);

      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }

      apiLogger.info("Sync complete!");

      res.json({
        success: true,
        playersCount: players.length,
        betsCount: generatedBets.length,
        message: `Successfully synced ${players.length} NBA players and generated ${generatedBets.length} betting opportunities.`
      });
    } catch (error) {
      apiLogger.error("Error syncing players:", error);
      res.status(500).json({
        error: "Failed to sync players",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Alias for backward compatibility or frontend usage
  app.post("/api/sync/players", async (req, res) => {
    // Redirect to admin sync
    res.redirect(307, "/api/admin/sync-rosters");
  });

}
