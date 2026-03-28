import type { Express } from "express";
import { pool } from "../db";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { isOddsApiConfigured, getOddsApiStatus, fetchNbaEvents, fetchEventPlayerProps, extractGameOdds } from "../odds-api";

export function registerLinesRoutes(app: Express): void {
  app.get("/api/sportsbooks", async (req, res) => {
    try {
      const books = await storage.getSportsbooks();
      res.json(books);
    } catch (error) {
      apiLogger.error("Error fetching sportsbooks:", error);
      res.status(500).json({ error: "Failed to fetch sportsbooks" });
    }
  });

  // Get player prop lines
  app.get("/api/lines/player/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const lines = await storage.getPlayerPropLines(playerId, stat, gameDate);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching player lines:", error);
      res.status(500).json({ error: "Failed to fetch player lines" });
    }
  });

  // Get latest lines for a player/stat
  app.get("/api/lines/latest/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const lines = await storage.getLatestLines(playerId, stat);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching latest lines:", error);
      res.status(500).json({ error: "Failed to fetch latest lines" });
    }
  });

  // Get line comparison for a player (all sportsbooks)
  app.get("/api/lines/compare/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string;

      if (isNaN(playerId) || !stat || !gameDate) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const comparison = await storage.compareLines(playerId, stat, gameDate);
      res.json(comparison);
    } catch (error) {
      apiLogger.error("Error comparing lines:", error);
      res.status(500).json({ error: "Failed to compare lines" });
    }
  });

  // Get line movements for a player
  app.get("/api/lines/movements/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const movements = await storage.getLineMovements(playerId, stat, gameDate);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching line movements:", error);
      res.status(500).json({ error: "Failed to fetch line movements" });
    }
  });

  // Get recent line movements (all players)
  app.get("/api/lines/movements/recent", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const movements = await storage.getRecentLineMovements(hours);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching recent movements:", error);
      res.status(500).json({ error: "Failed to fetch recent movements" });
    }
  });

  // Get best available lines
  app.get("/api/lines/best/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const bestLines = await storage.getBestLines(playerId, stat);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines:", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  // Get best lines for a specific date
  app.get("/api/lines/best/date/:gameDate", async (req, res) => {
    try {
      const { gameDate } = req.params;
      const bestLines = await storage.getBestLinesForDate(gameDate);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines for date:", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  // Save a user bet

  app.get("/api/odds/status", async (_req, res) => {
    try {
      const status = await getOddsApiStatus();
      res.json(status);
    } catch (error) {
      apiLogger.error("Error checking odds API status:", error);
      res.status(500).json({ error: "Failed to check odds API status" });
    }
  });

  // Get today's NBA games with odds availability
  app.get("/api/odds/events", async (_req, res) => {
    try {
      if (!isOddsApiConfigured()) {
        return res.status(503).json({
          error: "Odds API not configured",
          message: "Add THE_ODDS_API_KEY to your .env file"
        });
      }

      const events = await fetchNbaEvents();
      res.json(events);
    } catch (error) {
      apiLogger.error("Error fetching odds events:", error);
      res.status(500).json({ error: "Failed to fetch odds events" });
    }
  });

  // Get player props for a specific game/event
  app.get("/api/odds/events/:eventId/props", async (req, res) => {
    try {
      if (!isOddsApiConfigured()) {
        return res.status(503).json({
          error: "Odds API not configured",
          message: "Add THE_ODDS_API_KEY to your .env file"
        });
      }

      const { eventId } = req.params;
      if (!eventId) {
        return res.status(400).json({ error: "Event ID is required" });
      }

      const props = await fetchEventPlayerProps(eventId);
      if (!props) {
        return res.status(404).json({ error: "No props found for this event" });
      }


      res.json(props);
    } catch (error) {
      apiLogger.error("Error fetching event props:", error);
      res.status(500).json({ error: "Failed to fetch event props" });
    }
  });

  // =============== ADVANCED STATS ===============

  // Cache for advanced stats
  let advancedStatsCache: { data: any; timestamp: number } | null = null;

}
