import type { Express } from "express";
import { spawn } from "child_process";
import path from "path";
import { storage } from "../storage";
import { pool } from "../db";
import { apiLogger } from "../logger";
import { getPythonCommand, ensurePlayersLoaded } from "./route-helpers";

export function registerStatsRoutes(app: Express): void {
  let advancedStatsCache: { data: any; timestamp: number } | null = null;
  app.get("/api/stats/advanced", async (req, res) => {
    try {
      // Check cache (4 hours)
      if (advancedStatsCache && Date.now() - advancedStatsCache.timestamp < 4 * 60 * 60 * 1000) {
        return res.json(advancedStatsCache.data);
      }

      apiLogger.info("Fetching advanced stats from Python...");
      const pythonProcess = spawn(getPythonCommand(), [
        "server/nba-prop-model/api.py",
        "--advanced-stats"
      ]);

      let dataString = "";
      let errorString = "";

      pythonProcess.on("error", (err) => {
        apiLogger.error("Failed to start Python process", err);
        res.status(500).json({ error: "Failed to start model process", details: err.message });
      });

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          apiLogger.error("Python script error:", errorString);
          return res.status(500).json({
            error: "Failed to fetch advanced stats",
            details: errorString || "Process exited with non-zero code",
            stdoutSnippet: dataString.slice(0, 500)
          });
        }

        try {
          const jsonData = JSON.parse(dataString);
          advancedStatsCache = { data: jsonData, timestamp: Date.now() };
          res.json(jsonData);
        } catch (e) {
          apiLogger.error("Failed to parse Python output:", e);
          res.status(500).json({
            error: "Invalid data format from analytics engine",
            details: (e as Error).message,
            contentPrefix: dataString.slice(0, 500)
          });
        }
      });
    } catch (error) {
      apiLogger.error("Error in /api/stats/advanced:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== TRACKING-DERIVED STATS ===============

  app.get("/api/stats/tracking/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      if (isNaN(playerId)) {
        return res.status(400).json({ error: "Invalid player ID" });
      }

      const players = await ensurePlayersLoaded();
      const player = players.find(p => p.player_id === playerId);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      const { computeTrackingStats } = await import("../tracking-stats");
      const trackingStats = computeTrackingStats(player);
      res.json(trackingStats);
    } catch (error) {
      apiLogger.error("Error in /api/stats/tracking:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== PRIZEPICKS ROUTES ===============

  // Get scraper configuration status
}
