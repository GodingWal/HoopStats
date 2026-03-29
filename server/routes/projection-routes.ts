import type { Express } from "express";
import { spawn } from "child_process";
import path from "path";
import { storage } from "../storage";
import { pool } from "../db";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import type { Player, HitRateEntry } from "@shared/schema";
import { adjustedHitRate } from "../utils/statistics";
import { evaluateBetValue } from "../utils/ev-calculator";
import { analyzeEdges } from "../edge-detection";
import { fetchTodaysGameInjuries, type PlayerInjuryReport } from "../espn-api";
import { loadSignalWeights, calculateSignalScore } from "../signal-scoring";
import { calibrateBet } from "../confidence-calibration";
import { batchXGBoostPredict, type XGBoostPrediction } from "../xgboost-service";
import { ensurePlayersLoaded, normalCDF, erf, probToAmericanOdds, parseHitRateEntry, getPythonCommand, getCached, setCached } from "./route-helpers";

export function registerProjectionRoutes(app: Express): void {
  app.post("/api/projections", async (req, res) => {
    try {
      const { players, includeInjuries = true } = req.body;
      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");

      // Build command args
      const args = ["--players", ...players];

      // If includeInjuries is true, fetch current injuries and include them
      let injuredPlayers: string[] = [];
      if (includeInjuries) {
        try {
          // Get today's injuries
          const injuries = await fetchTodaysGameInjuries();

          const injuredMinutesMap: Record<string, number> = {};

          injuries.forEach((inj: PlayerInjuryReport) => {
            if (inj.status === 'out') {
              // Default to 25 minutes for now until we lookup actual averages
              injuredMinutesMap[inj.playerName] = 25.0;
              injuredPlayers.push(inj.playerName);
            }
          });

          if (injuredPlayers.length > 0) {
            args.push("--injured_minutes", JSON.stringify(injuredMinutesMap));
          }
        } catch (injError) {
          apiLogger.warn("Could not fetch injuries for projections:", { error: injError });
          // Continue without injury data
        }
      }

      apiLogger.info(`Running python script: ${scriptPath} with players: ${players.join(", ")}`);
      if (injuredPlayers.length > 0) {
        apiLogger.info(`  Injuries factored in: ${injuredPlayers.join(", ")}`);
      }

      const pythonProcess = spawn(getPythonCommand(), [scriptPath, ...args]);

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
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          // Add injury context to response
          res.json({
            ...json,
            injuryContext: {
              injuriesIncluded: includeInjuries,
              injuredPlayers: injuredPlayers,
              injuryCount: injuredPlayers.length,
            }
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output. Data:", dataString);
          apiLogger.error("Stderr:", errorString);
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating projections:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== ENHANCED PROJECTIONS & ANALYTICS ROUTES ===============

  // Get best betting recommendations for today
  app.get("/api/recommendations/today", async (req, res) => {
    try {
      const minEdge = parseFloat(req.query.minEdge as string) || 0.03;
      const recommendations = await storage.getTodaysRecommendations();
      const filtered = recommendations.filter(r => r.edge >= minEdge);
      res.json(filtered);
    } catch (error) {
      apiLogger.error("Error fetching today's recommendations:", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // Get projection and edge for specific player/prop
  app.get("/api/projections/player/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const line = parseFloat(req.query.line as string);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || isNaN(line) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      // Get player data
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Call Python model to get projection with distribution
      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
      const pythonProcess = spawn(getPythonCommand(), [scriptPath, "--players", player.player_name]);

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
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projection failed", details: errorString });
        }
        try {
          const projectionData = JSON.parse(dataString);
          const playerProj = projectionData.projections[0];

          if (!playerProj || !playerProj.distributions[stat]) {
            return res.status(400).json({ error: `No projection available for stat: ${stat}` });
          }

          const dist = playerProj.distributions[stat];
          const mean = dist.mean;
          const std = dist.std;

          // Calculate probabilities (assuming normal distribution)
          const probOver = 1 - normalCDF(line, mean, std);
          const probUnder = normalCDF(line, mean, std);

          // Calculate edge (assuming -110 odds, break-even = 52.4%)
          const breakEven = BETTING_CONFIG.BREAK_EVEN_PROB;
          const edgeOver = probOver - breakEven;
          const edgeUnder = probUnder - breakEven;

          const edge = Math.max(edgeOver, edgeUnder);
          const recommendedSide = edgeOver > edgeUnder ? 'over' : 'under';
          const confidence = edge > 0.06 ? 'high' : edge > 0.03 ? 'medium' : 'low';

          res.json({
            playerId,
            playerName: player.player_name,
            stat,
            line,
            projectedMean: mean,
            projectedStd: std,
            probOver,
            probUnder,
            edge: Math.abs(edge),
            recommendedSide: edge >= 0.03 ? recommendedSide : 'no_bet',
            confidence,
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output:", dataString);
          res.status(500).json({ error: "Invalid response from model" });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating projection:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Evaluate a parlay
  app.post("/api/projections/parlay", async (req, res) => {
    try {
      const { legs } = req.body;

      if (!legs || !Array.isArray(legs) || legs.length === 0) {
        return res.status(400).json({ error: "Invalid legs array" });
      }

      // Get projections for each leg
      const probabilities: number[] = [];

      for (const leg of legs) {
        const player = await storage.getPlayer(leg.playerId);
        if (!player) {
          return res.status(404).json({ error: `Player not found: ${leg.playerId}` });
        }

        // Call Python model for this player
        const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
        const pythonProcess = spawn(getPythonCommand(), [scriptPath, "--players", player.player_name]);

        const projection = await new Promise<number>((resolve, reject) => {
          let dataString = "";

          pythonProcess.on("error", (err) => {
            reject(new Error(`Failed to start Python process: ${err.message}`));
          });

          pythonProcess.stdout.on("data", (data) => {
            dataString += data.toString();
          });

          pythonProcess.on("close", (code) => {
            if (code !== 0) {
              reject(new Error("Python script failed"));
              return;
            }
            try {
              const projectionData = JSON.parse(dataString);
              const playerProj = projectionData.projections[0];
              const dist = playerProj.distributions[leg.stat];
              const mean = dist.mean;
              const std = dist.std;

              const prob = leg.side === 'over'
                ? 1 - normalCDF(leg.line, mean, std)
                : normalCDF(leg.line, mean, std);

              resolve(prob);
            } catch (e) {
              reject(e);
            }
          });
        });

        probabilities.push(projection);
      }

      // Calculate parlay probability (product of individual probabilities)
      const parlayProb = probabilities.reduce((acc, p) => acc * p, 1);

      // Convert to American odds
      const fairOdds = probToAmericanOdds(parlayProb);

      res.json({
        probability: parlayProb,
        fairOdds,
        legs: legs.length,
        individualProbs: probabilities,
      });
    } catch (error) {
      apiLogger.error("Error evaluating parlay:", error);
      res.status(500).json({ error: "Failed to evaluate parlay" });
    }
  });

  // Get track record
  app.get("/api/track-record", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const record = await storage.getTrackRecord(days);
      res.json(record);
    } catch (error) {
      apiLogger.error("Error fetching track record:", error);
      res.status(500).json({ error: "Failed to fetch track record" });
    }
  });


  // Get rolling accuracy data for chart
  app.get("/api/rolling-accuracy", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 90;
      const result = await pool!.query(`
        WITH daily_stats AS (
          SELECT
            po.game_date::text as game_date,
            COUNT(*) as total,
            SUM(CASE
              WHEN (po.final_projection > po.prizepicks_line AND pdl.actual_value > pdl.opening_line)
                OR (po.final_projection < po.prizepicks_line AND pdl.actual_value < pdl.opening_line)
              THEN 1 ELSE 0
            END) as wins
          FROM projection_outputs po
          JOIN prizepicks_daily_lines pdl
            ON po.player_id = pdl.prizepicks_player_id
            AND po.game_date = pdl.game_date
            AND po.prop_type = pdl.stat_type
          WHERE pdl.actual_value IS NOT NULL
            AND po.confidence_tier != 'SKIP'
            AND po.game_date >= CURRENT_DATE - $1 * INTERVAL '1 day'
          GROUP BY po.game_date
          ORDER BY po.game_date ASC
        )
        SELECT
          game_date,
          total,
          wins,
          CASE WHEN total > 0
            THEN ROUND(100.0 * wins / total, 1)
            ELSE 0
          END as daily_accuracy
        FROM daily_stats
      `, [days]);

      const rows = result.rows.map(r => ({
        date: r.game_date,
        total: Number(r.total),
        wins: Number(r.wins),
        dailyAccuracy: Number(Number(r.daily_accuracy).toFixed(1)),
        rolling7: 0,
        rolling30: 0,
      }));

      for (let i = 0; i < rows.length; i++) {
        let w7 = 0, t7 = 0;
        for (let j = Math.max(0, i - 6); j <= i; j++) {
          w7 += rows[j].wins;
          t7 += rows[j].total;
        }
        rows[i].rolling7 = t7 > 0 ? Number((100 * w7 / t7).toFixed(1)) : 0;

        let w30 = 0, t30 = 0;
        for (let j = Math.max(0, i - 29); j <= i; j++) {
          w30 += rows[j].wins;
          t30 += rows[j].total;
        }
        rows[i].rolling30 = t30 > 0 ? Number((100 * w30 / t30).toFixed(1)) : 0;
      }

      res.json(rows);
    } catch (error) {
      apiLogger.error("Error fetching rolling accuracy:", error);
      res.status(500).json({ error: "Failed to fetch rolling accuracy" });
    }
  });

  // Serve latest daily email summary as HTML page
  app.get("/api/daily-summary", async (req, res) => {
    try {
      const fs = await import("fs");
      const path = "/var/log/courtsideedge/last_email.html";
      if (fs.existsSync(path)) {
        const html = fs.readFileSync(path, "utf-8");
        res.setHeader("Content-Type", "text/html");
        res.send(html);
      } else {
        res.status(404).json({ error: "No daily summary available yet" });
      }
    } catch (error) {
      apiLogger.error("Error serving daily summary:", error);
      res.status(500).json({ error: "Failed to load daily summary" });
    }
  });



  // =============== LINE TRACKING ROUTES ===============

  // Get all sportsbooks

  app.post("/api/projections/with-injuries", async (req, res) => {
    try {
      const { players, injuries } = req.body;

      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");

      // Build args with injury context
      const args = ["--players", ...players];
      if (injuries && Array.isArray(injuries) && injuries.length > 0) {
        args.push("--injuries", ...injuries);
      }

      apiLogger.info(`Running python script with injuries: ${args.join(' ')}`);

      const pythonProcess = spawn(getPythonCommand(), [scriptPath, ...args]);

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
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          res.json({
            ...json,
            injuryContext: {
              injuredPlayers: injuries || [],
              injuryCount: (injuries || []).length,
            }
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output. Data:", dataString);
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating injury-adjusted projections:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== ON/OFF SPLITS ROUTES ===============

  // Get all teammates' stat changes when a player sits

  app.get("/api/projections/today", async (req, res) => {
    try {
      const gameDate =
        (req.query.date as string) ||
        new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

      const cacheKey = `projections_today_${gameDate}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({
          projections: cached.data,
          cached: true,
          cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000),
        });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `SELECT po.*, p.player_name
         FROM projection_outputs po
         LEFT JOIN players p ON po.player_id = CAST(p.player_id AS text)
         WHERE po.game_date = $1
         ORDER BY ABS(po.edge_pct) DESC`,
        [gameDate]
      );

      const projections = result.rows.map((row) => ({
        ...row,
        signals_fired:
          typeof row.signals_fired === "string"
            ? JSON.parse(row.signals_fired)
            : row.signals_fired,
      }));

      setCached(cacheKey, projections);
      res.json({ projections, cached: false });
    } catch (error: any) {
      apiLogger.error("[Projections Today] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/projections/:id — Single projection with signals breakdown
  app.get("/api/projections/:id", async (req, res) => {
    try {
      const { id } = req.params;
      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }
      const result = await pool.query(
        `SELECT po.*, p.player_name
         FROM projection_outputs po
         LEFT JOIN players p ON po.player_id = CAST(p.player_id AS text)
         WHERE po.id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Projection not found" });
      }
      const row = result.rows[0];
      res.json({
        ...row,
        signals_fired:
          typeof row.signals_fired === "string"
            ? JSON.parse(row.signals_fired)
            : row.signals_fired,
      });
    } catch (error: any) {
      apiLogger.error("[Projection Detail] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/signals/history?days=30 — Signal hit rates by type
}
