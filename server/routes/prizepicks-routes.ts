import type { Express } from "express";
import { apiLogger } from "../logger";
import { fetchPrizePicksProjections, fetchPlayerPrizePicksProps, getScraperStatus, rotateScraperSession, addScraperProxies, resetFailedProxies, resetScraperStats } from "../prizepicks-api";
import { prizePicksLineTracker } from "../prizepicks-line-tracker";
import { prizePicksStorage } from "../storage/prizepicks-storage";

export function registerPrizePicksRoutes(app: Express): void {
  app.get("/api/prizepicks/scraper/status", async (_req, res) => {
    try {
      const status = getScraperStatus();
      res.json(status);
    } catch (error) {
      apiLogger.error("Error fetching scraper status:", error);
      res.status(500).json({ error: "Failed to fetch scraper status" });
    }
  });

  // Force rotate the scraper session (useful when blocked)
  app.post("/api/prizepicks/scraper/rotate", async (_req, res) => {
    try {
      const newSession = rotateScraperSession();
      res.json({
        success: true,
        message: "Scraper session rotated",
        newSession,
      });
    } catch (error) {
      apiLogger.error("Error rotating scraper session:", error);
      res.status(500).json({ error: "Failed to rotate scraper session" });
    }
  });

  // Add proxies to the scraper
  app.post("/api/prizepicks/scraper/proxies", async (req, res) => {
    try {
      const { proxies } = req.body;
      if (!proxies || !Array.isArray(proxies)) {
        return res.status(400).json({ error: "proxies array is required" });
      }
      addScraperProxies(proxies);
      res.json({
        success: true,
        message: `Added ${proxies.length} proxies`,
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error adding proxies:", error);
      res.status(500).json({ error: "Failed to add proxies" });
    }
  });

  // Reset failed proxies (give them another chance)
  app.post("/api/prizepicks/scraper/proxies/reset", async (_req, res) => {
    try {
      resetFailedProxies();
      res.json({
        success: true,
        message: "Reset all failed proxies",
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error resetting proxies:", error);
      res.status(500).json({ error: "Failed to reset proxies" });
    }
  });

  // Reset scraper statistics
  app.post("/api/prizepicks/scraper/stats/reset", async (_req, res) => {
    try {
      resetScraperStats();
      res.json({
        success: true,
        message: "Reset scraper statistics",
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error resetting stats:", error);
      res.status(500).json({ error: "Failed to reset stats" });
    }
  });

  // Get all NBA PrizePicks projections
  app.get("/api/prizepicks/projections", async (_req, res) => {
    try {
      const projections = await fetchPrizePicksProjections();
      res.json(projections);
    } catch (error) {
      apiLogger.error("Error fetching PrizePicks projections:", error);
      res.status(500).json({
        error: "Failed to fetch PrizePicks projections",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get PrizePicks props for a specific player
  app.get("/api/prizepicks/player/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      const props = await fetchPlayerPrizePicksProps(decodeURIComponent(playerName));
      res.json(props);
    } catch (error) {
      apiLogger.error("Error fetching player PrizePicks props:", error);
      res.status(500).json({ error: "Failed to fetch player props" });
    }
  });

  // =============== PRIZEPICKS LINE TRACKING ROUTES ===============

  // Get PrizePicks line tracker status
  app.get("/api/prizepicks/tracker/status", async (_req, res) => {
    try {
      const stats = prizePicksLineTracker.getStats();
      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching PrizePicks tracker status:", error);
      res.status(500).json({ error: "Failed to fetch tracker status" });
    }
  });

  // Start PrizePicks line tracking
  app.post("/api/prizepicks/tracker/start", async (req, res) => {
    try {
      const intervalMs = parseInt(req.query.interval as string) || 300000; // Default 5 minutes
      prizePicksLineTracker.setStorage(prizePicksStorage);
      prizePicksLineTracker.start(intervalMs);
      res.json({
        success: true,
        message: `PrizePicks line tracker started with ${intervalMs / 1000}s interval`,
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error starting PrizePicks tracker:", error);
      res.status(500).json({ error: "Failed to start tracker" });
    }
  });

  // Stop PrizePicks line tracking
  app.post("/api/prizepicks/tracker/stop", async (_req, res) => {
    try {
      prizePicksLineTracker.stop();
      res.json({
        success: true,
        message: "PrizePicks line tracker stopped",
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error stopping PrizePicks tracker:", error);
      res.status(500).json({ error: "Failed to stop tracker" });
    }
  });

  // Force a poll of PrizePicks lines
  app.post("/api/prizepicks/tracker/poll", async (_req, res) => {
    try {
      // Ensure storage is connected
      prizePicksLineTracker.setStorage(prizePicksStorage);
      await prizePicksLineTracker.pollNow();
      res.json({
        success: true,
        message: "Poll completed",
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error polling PrizePicks lines:", error);
      res.status(500).json({ error: "Failed to poll lines" });
    }
  });

  // Get current in-memory lines (fast, no DB)
  app.get("/api/prizepicks/lines/current", async (_req, res) => {
    try {
      const lines = prizePicksLineTracker.getCurrentLines();
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching current lines:", error);
      res.status(500).json({ error: "Failed to fetch current lines" });
    }
  });

  // Get historical lines for a player
  app.get("/api/prizepicks/lines/player/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      const lines = await prizePicksStorage.getPrizePicksLinesByPlayer(
        decodeURIComponent(playerName)
      );
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching player line history:", error);
      res.status(500).json({ error: "Failed to fetch player line history" });
    }
  });

  // Get line history for a specific player/stat/game
  app.get("/api/prizepicks/lines/history", async (req, res) => {
    try {
      const { playerId, statType, gameTime } = req.query;

      if (!playerId || !statType || !gameTime) {
        return res.status(400).json({
          error: "Missing required parameters: playerId, statType, gameTime",
        });
      }

      const history = await prizePicksStorage.getPrizePicksLineHistory(
        playerId as string,
        statType as string,
        new Date(gameTime as string)
      );

      res.json(history);
    } catch (error) {
      apiLogger.error("Error fetching line history:", error);
      res.status(500).json({ error: "Failed to fetch line history" });
    }
  });

  // Get recent line movements
  app.get("/api/prizepicks/movements", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const movements = await prizePicksStorage.getRecentPrizePicksMovements(limit);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching line movements:", error);
      res.status(500).json({ error: "Failed to fetch line movements" });
    }
  });

  // Get significant movements (alerts)
  app.get("/api/prizepicks/movements/significant", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const movements = await prizePicksStorage.getSignificantMovements(hours);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching significant movements:", error);
      res.status(500).json({ error: "Failed to fetch significant movements" });
    }
  });

  // Get daily line summary for a date
  app.get("/api/prizepicks/daily", async (req, res) => {
    try {
      const dateStr = req.query.date as string;
      const date = dateStr ? new Date(dateStr) : new Date();

      const dailyLines = await prizePicksStorage.getPrizePicksDailyLines(date);
      res.json(dailyLines);
    } catch (error) {
      apiLogger.error("Error fetching daily lines:", error);
      res.status(500).json({ error: "Failed to fetch daily lines" });
    }
  });

  // Get player line trend over time
  app.get("/api/prizepicks/trend/:playerName/:statType", async (req, res) => {
    try {
      const { playerName, statType } = req.params;
      const days = parseInt(req.query.days as string) || 30;

      if (!playerName || !statType) {
        return res.status(400).json({ error: "Player name and stat type are required" });
      }

      const trend = await prizePicksStorage.getPlayerLineTrend(
        decodeURIComponent(playerName),
        decodeURIComponent(statType),
        days
      );

      res.json(trend);
    } catch (error) {
      apiLogger.error("Error fetching player line trend:", error);
      res.status(500).json({ error: "Failed to fetch line trend" });
    }
  });

  // Get all current lines from database (with full history available)
  app.get("/api/prizepicks/lines/all", async (_req, res) => {
    try {
      const lines = await prizePicksStorage.getCurrentPrizePicksLines();
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching all current lines:", error);
      res.status(500).json({ error: "Failed to fetch all current lines" });
    }
  });

  // Get lines database stats (total counts, date ranges, etc.)
  app.get("/api/prizepicks/lines/database/stats", async (_req, res) => {
    try {
      const stats = await prizePicksStorage.getLinesDbStats();
      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching lines database stats:", error);
      res.status(500).json({ error: "Failed to fetch lines database stats" });
    }
  });

  // Browse all stored lines with pagination and filters
  app.get("/api/prizepicks/lines/database", async (req, res) => {
    try {
      const result = await prizePicksStorage.browseStoredLines({
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 50,
        playerSearch: req.query.search as string,
        statType: req.query.statType as string,
        gameDate: req.query.gameDate as string,
        sortBy: (req.query.sortBy as string) as any,
        sortDir: (req.query.sortDir as string) as any,
      });
      res.json(result);
    } catch (error) {
      apiLogger.error("Error browsing lines database:", error);
      res.status(500).json({ error: "Failed to browse lines database" });
    }
  });

  // Browse daily lines history with pagination and filters
  app.get("/api/prizepicks/lines/database/daily", async (req, res) => {
    try {
      const result = await prizePicksStorage.getDailyLinesHistory({
        page: parseInt(req.query.page as string) || 1,
        pageSize: parseInt(req.query.pageSize as string) || 50,
        playerSearch: req.query.search as string,
        statType: req.query.statType as string,
        startDate: req.query.startDate as string,
        endDate: req.query.endDate as string,
      });
      res.json(result);
    } catch (error) {
      apiLogger.error("Error browsing daily lines history:", error);
      res.status(500).json({ error: "Failed to browse daily lines history" });
    }
  });

  // =============== INJURY TRACKING ROUTES ===============

  // Get injury watcher status
}
