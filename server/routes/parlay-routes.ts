import type { Express } from "express";
import { spawn } from "child_process";
import path from "path";
import { pool } from "../db";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import { calibrateBet } from "../confidence-calibration";
import { onOffService } from "../on-off-service";
import { normalCDF, getPythonCommand } from "./route-helpers";

export function registerParlayRoutes(app: Express): void {
  app.post("/api/bets/user", async (req, res) => {
    try {
      const bet = req.body;
      const savedBet = await storage.saveUserBet(bet);
      res.json(savedBet);
    } catch (error) {
      apiLogger.error("Error saving user bet:", error);
      res.status(500).json({ error: "Failed to save bet" });
    }
  });

  // Get user bets
  app.get("/api/bets/user", async (req, res) => {
    try {
      const pending = req.query.pending === 'true';
      const gameDate = req.query.gameDate as string | undefined;

      const bets = await storage.getUserBets({ pending, gameDate });
      res.json(bets);
    } catch (error) {
      apiLogger.error("Error fetching user bets:", error);
      res.status(500).json({ error: "Failed to fetch user bets" });
    }
  });

  // Update user bet result
  app.patch("/api/bets/user/:betId", async (req, res) => {
    try {
      const betId = parseInt(req.params.betId);
      const { result, actualValue, profit } = req.body;

      if (isNaN(betId) || !result || actualValue === undefined || profit === undefined) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      await storage.updateUserBetResult(betId, result, actualValue, profit);
      res.json({ success: true });
    } catch (error) {
      apiLogger.error("Error updating bet result:", error);
      res.status(500).json({ error: "Failed to update bet result" });
    }
  });

  // =============== PARLAY ROUTES ===============

  // Create a parlay
  app.post("/api/parlays", async (req, res) => {
    try {
      const { parlayType, numPicks, entryAmount, payoutMultiplier, picks } = req.body;

      // Resolve missing team abbreviations from the players table
      // so auto-settle can match picks to the correct game
      const enrichedPicks = await Promise.all(
        (picks as Array<{ playerName: string; team: string; stat: string; line: number; side: string; gameDate: string }>).map(async (pick) => {
          if (pick.team && pick.team.trim() !== "") return pick;
          try {
            const player = await storage.getPlayerByName(pick.playerName);
            if (player?.team) {
              return { ...pick, team: player.team };
            }
          } catch {
            // Lookup failed — proceed with empty team
          }
          return pick;
        })
      );

      const savedParlay = await storage.saveParlay({
        parlayType,
        numPicks,
        entryAmount,
        payoutMultiplier,
        result: 'pending',
      }, enrichedPicks);
      res.json(savedParlay);
    } catch (error) {
      apiLogger.error("Error saving parlay:", error);
      res.status(500).json({ error: "Failed to save parlay" });
    }
  });

  // Get user parlays
  app.get("/api/parlays", async (req, res) => {
    try {
      const pending = req.query.pending === 'true';
      const parlays = await storage.getParlays({ pending });
      res.json(parlays);
    } catch (error) {
      apiLogger.error("Error fetching parlays:", error);
      res.status(500).json({ error: "Failed to fetch parlays" });
    }
  });

  // Update parlay result
  app.patch("/api/parlays/:parlayId", async (req, res) => {
    try {
      const parlayId = parseInt(req.params.parlayId);
      const { result, profit } = req.body;
      const updatedParlay = await storage.updateParlayResult(parlayId, result, profit);
      res.json(updatedParlay);
    } catch (error) {
      apiLogger.error("Error updating parlay result:", error);
      res.status(500).json({ error: "Failed to update parlay result" });
    }
  });

  // Update parlay pick result
  app.patch("/api/parlays/:parlayId/picks/:pickId", async (req, res) => {
    try {
      const pickId = parseInt(req.params.pickId);
      const { result, actualValue } = req.body;
      const updatedPick = await storage.updateParlayPickResult(pickId, result, actualValue);
      res.json(updatedPick);
    } catch (error) {
      apiLogger.error("Error updating pick result:", error);
      res.status(500).json({ error: "Failed to update pick result" });
    }
  });

  // =============== SETTLEMENT ROUTES ===============

  // Manually trigger settlement (useful after reboot or for testing)
  app.post("/api/settle", async (_req, res) => {
    try {
      const { runSettlement } = await import("./services/auto-settle");
      const result = await runSettlement();
      res.json({
        success: true,
        settledPicks: result.settledPicks,
        settledParlays: result.settledParlays,
        message: `Settled ${result.settledPicks} picks across ${result.settledParlays} parlays`,
      });
    } catch (error) {
      apiLogger.error("Error running settlement:", error);
      res.status(500).json({ error: "Failed to run settlement" });
    }
  });

  // =============== ODDS API ROUTES ===============

  // Check if odds API is configured

  app.get("/api/correlated-parlays", async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const size = parseInt((req.query.size as string) || "0", 10) || null;
      const minEv = parseFloat((req.query.min_ev as string) || "0");
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);

      let query = `
        SELECT
          id, legs, correlations, parlay_type, parlay_template,
          leg_count, base_hit_prob, true_hit_prob, payout,
          combined_ev, recommendation, avoid_reason,
          outcome, payout_received, game_date, created_at
        FROM parlay_results
        WHERE game_date = $1
          AND combined_ev >= $2
      `;
      const params: any[] = [date, minEv];

      if (size) {
        params.push(size);
        query += ` AND leg_count = $${params.length}`;
      }

      query += ` ORDER BY combined_ev DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(query, params);
      res.json({ date, parlays: result.rows, count: result.rows.length });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching parlays:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/parlays/correlations?player_a=X&player_b=Y&stat=pts
   * Look up a specific pairwise correlation from the cache.
   */
  app.get("/api/parlays/correlations", async (req, res) => {
    try {
      const { player_a, player_b, stat } = req.query as Record<string, string>;
      if (!player_a || !player_b) {
        return res.status(400).json({ error: "player_a and player_b are required" });
      }
      const statType = stat || "pts";

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `SELECT *
         FROM player_correlations
         WHERE (
           (player_a_id = $1 AND player_b_id = $2)
           OR (player_a_id = $2 AND player_b_id = $1)
         )
         AND stat_type = $3
         LIMIT 1`,
        [player_a, player_b, statType]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Correlation not found in cache" });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching correlation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/parlays/team-matrix?team_id=X&stat=pts
   * Return all cached pairwise correlations for a team's rotation.
   */
  app.get("/api/parlays/team-matrix", async (req, res) => {
    try {
      const { team_id, stat } = req.query as Record<string, string>;
      if (!team_id) {
        return res.status(400).json({ error: "team_id is required" });
      }
      const statType = stat || "pts";

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `SELECT
           pc.player_a_id, pc.player_b_id, pc.correlation,
           pc.relationship, pc.confidence, pc.sample_size,
           pc.same_team, pc.updated_at
         FROM player_correlations pc
         WHERE pc.stat_type = $1
           AND pc.same_team = true
           AND pc.confidence IN ('HIGH', 'MEDIUM')
           AND (
             pc.player_a_id IN (
               SELECT DISTINCT CAST(player_id AS VARCHAR)
               FROM player_game_stats
               WHERE team_id = $2
                 AND game_date >= NOW() - INTERVAL '60 days'
             )
             OR pc.player_b_id IN (
               SELECT DISTINCT CAST(player_id AS VARCHAR)
               FROM player_game_stats
               WHERE team_id = $2
                 AND game_date >= NOW() - INTERVAL '60 days'
             )
           )
         ORDER BY ABS(pc.correlation) DESC`,
        [statType, team_id]
      );

      res.json({ team_id, stat: statType, correlations: result.rows });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching team matrix:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/parlays/generate
   * Trigger the parlay builder Python script for a given date.
   * Body: { date?: string, parlay_size?: number }
   */
  app.post("/api/parlays/generate", async (req, res) => {
    try {
      const { date, parlay_size } = req.body as {
        date?: string;
        parlay_size?: number;
      };
      const targetDate = date || new Date().toISOString().slice(0, 10);
      const size = parlay_size || 2;

      const pythonCmd = getPythonCommand();
      const scriptPath = path.join(
        process.cwd(),
        "server",
        "nba-prop-model",
        "scripts",
        "cron_jobs.py"
      );

      // Spawn Python script in background (non-blocking) to avoid browser timeout
      const child = spawn(pythonCmd, [
        scriptPath,
        "parlays",
        "--date",
        targetDate,
        "--size",
        String(size),
      ], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });

      let bgStderr = "";
      child.stderr?.on("data", (d: Buffer) => { bgStderr += d.toString(); });
      child.on("close", (code: number) => {
        if (code !== 0) {
          apiLogger.error(`[Parlays] background generate script exited ${code}: ${bgStderr}`);
        } else {
          apiLogger.info(`[Parlays] background generate completed for ${targetDate} size=${size}`);
        }
      });
      child.unref();

      // Return existing data immediately — frontend will auto-refetch for fresh results
      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }
      const result = await pool.query(
        `SELECT id, legs, correlations, parlay_type, parlay_template,
                leg_count, base_hit_prob, true_hit_prob, payout,
                combined_ev, recommendation, avoid_reason, game_date
         FROM parlay_results
         WHERE game_date = $1
           AND leg_count = $2
         ORDER BY combined_ev DESC
         LIMIT 20`,
        [targetDate, size]
      );

      res.json({
        date: targetDate,
        parlay_size: size,
        parlays: result.rows,
        count: result.rows.length,
        generating: true,
        message: "Parlay generation started in background. Results will auto-refresh.",
      });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error triggering generation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /api/parlays/:id/outcome
   * Settle a parlay once games complete.
   * Body: { outcome: boolean, payout_received?: number }
   */
  app.patch("/api/parlays/:id/outcome", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { outcome, payout_received } = req.body as {
        outcome: boolean;
        payout_received?: number;
      };

      if (typeof outcome !== "boolean") {
        return res.status(400).json({ error: "outcome must be a boolean" });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `UPDATE parlay_results
         SET outcome = $1, payout_received = $2
         WHERE id = $3
         RETURNING *`,
        [outcome, payout_received ?? null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Parlay not found" });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      apiLogger.error("[Parlays] Error settling parlay:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // XGBoost model status endpoint
}
