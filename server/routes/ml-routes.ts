import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import type { Player } from "@shared/schema";
import { getAvailableModels, getXGBoostPrediction, type XGBoostPrediction } from "../xgboost-service";
import { ensurePlayersLoaded } from "./route-helpers";
import { pool } from "../db";
import fs from "fs";
import path from "path";

export function registerMlRoutes(app: Express): void {
  app.get("/api/ml/status", async (_req, res) => {
    const models = getAvailableModels();
    res.json({
      xgboost_available: models.length > 0,
      trained_models: models,
      model_count: models.length,
      blend_weights: { xgboost: 0.4, analytical: 0.6 },
    });
  });

  // On-demand SHAP explanation for a specific player-prop prediction
  app.get("/api/ml/explain", async (req, res) => {
    try {
      const playerName = req.query.player as string;
      const statType = req.query.statType as string;
      const line = parseFloat(req.query.line as string);

      if (!playerName || !statType || isNaN(line)) {
        return res.status(400).json({ error: "Required: player, statType, line" });
      }

      // Find the player
      const players = await storage.getPlayers();
      const player = players.find(
        (p) => p.player_name.toLowerCase() === playerName.toLowerCase()
      );
      if (!player) {
        return res.status(404).json({ error: `Player not found: ${playerName}` });
      }

      const prediction = await getXGBoostPrediction(player, statType, line);
      if (!prediction) {
        return res.json({
          available: false,
          message: "No XGBoost model available for this stat type",
        });
      }

      res.json({
        available: true,
        player_name: player.player_name,
        stat_type: statType,
        line,
        prob_over: prediction.prob_over,
        prob_under: prediction.prob_under,
        confidence: prediction.confidence,
        predicted_hit: prediction.predicted_hit,
        model_type: prediction.model_type,
        calibration: {
          method: prediction.calibration_method,
          raw_prob_over: prediction.raw_prob_over,
          calibrated_prob_over: prediction.prob_over,
          shift: prediction.calibration_shift,
        },
        shap_explanation: {
          base_value: prediction.shap_base_value,
          top_drivers: prediction.shap_top_drivers,
        },
        top_features: prediction.top_features,
      });
    } catch (error: any) {
      apiLogger.error("ML explain error:", error);
      res.status(500).json({ error: "Failed to generate explanation" });
    }
  });


  // ============================================================
  // On-demand SHAP explanation — compute live for any player+stat+line
  // ============================================================
  app.get("/api/shap/live", async (req, res) => {
    try {
      const playerName = req.query.player as string;
      const statType = req.query.statType as string;
      const line = parseFloat(req.query.line as string);

      if (!playerName || !statType || isNaN(line)) {
        return res.status(400).json({ error: "Required: player, statType, line" });
      }

      // Find the player
      const players = await storage.getPlayers();
      const player = players.find(
        (p) => p.player_name.toLowerCase() === playerName.toLowerCase()
      );
      if (!player) {
        return res.status(404).json({ error: `Player not found: ${playerName}` });
      }

      // Get XGBoost prediction with SHAP
      const prediction = await getXGBoostPrediction(player, statType, line);
      if (!prediction) {
        return res.json({
          available: false,
          message: "No XGBoost model available for this stat type",
          drivers: [],
        });
      }

      // Format SHAP drivers for the UI
      const drivers = (prediction.shap_top_drivers || []).slice(0, 10);

      res.json({
        available: true,
        player_name: player.player_name,
        stat_type: statType,
        line,
        prob_over: prediction.prob_over,
        prob_under: prediction.prob_under,
        confidence: prediction.confidence,
        predicted_hit: prediction.predicted_hit,
        model_type: prediction.model_type,
        calibration: {
          method: prediction.calibration_method,
          raw_prob_over: prediction.raw_prob_over,
          shift: prediction.calibration_shift,
        },
        shap: {
          base_value: prediction.shap_base_value,
          drivers: drivers,
        },
      });
    } catch (error: any) {
      apiLogger.error("SHAP live error:", error);
      res.status(500).json({ error: "Failed to compute SHAP explanation" });
    }
  });

  // ============================================================
  // Model training status — data composition + last train metrics
  // ============================================================
  app.get("/api/model/training-status", async (_req, res) => {
    try {
      const MODEL_DIR = "/var/www/courtsideedge/server/nba-prop-model/models/xgboost";

      // Query DB for real vs synthetic counts per stat type
      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }
      const result = await pool.query<{
        stat_type: string;
        real_count: string;
        synthetic_count: string;
        total_count: string;
        hit_rate: string | null;
      }>(`
        SELECT
          stat_type,
          COUNT(*) FILTER (WHERE COALESCE(source, 'real') = 'real')       AS real_count,
          COUNT(*) FILTER (WHERE source = 'synthetic')                     AS synthetic_count,
          COUNT(*)                                                          AS total_count,
          ROUND(
            AVG(CASE WHEN hit THEN 1.0 ELSE 0.0 END)::numeric, 4
          )::text                                                           AS hit_rate
        FROM xgboost_training_log
        WHERE actual_value IS NOT NULL
        GROUP BY stat_type
        ORDER BY stat_type
      `);

      const byStatType: Record<string, {
        real: number;
        synthetic: number;
        total: number;
        hit_rate: number | null;
        last_trained_at: string | null;
        model_version: string | null;
        val_accuracy: number | null;
        val_logloss: number | null;
      }> = {};

      for (const row of result.rows) {
        byStatType[row.stat_type] = {
          real: parseInt(row.real_count, 10),
          synthetic: parseInt(row.synthetic_count, 10),
          total: parseInt(row.total_count, 10),
          hit_rate: row.hit_rate != null ? parseFloat(row.hit_rate) : null,
          last_trained_at: null,
          model_version: null,
          val_accuracy: null,
          val_logloss: null,
        };
      }

      // Overlay metadata from per-stat meta JSON files
      const STAT_TYPES = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Steals", "Blocks", "Turnovers"];
      for (const stat of STAT_TYPES) {
        const metaPath = path.join(MODEL_DIR, `${stat}_meta.json`);
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (!byStatType[stat]) {
              byStatType[stat] = {
                real: 0, synthetic: 0, total: 0, hit_rate: null,
                last_trained_at: null, model_version: null,
                val_accuracy: null, val_logloss: null,
              };
            }
            byStatType[stat].last_trained_at = meta.last_train_date ?? null;
            byStatType[stat].model_version = meta.model_version ?? null;
            byStatType[stat].val_accuracy = meta.metrics?.val_accuracy ?? null;
            byStatType[stat].val_logloss = meta.metrics?.val_logloss ?? null;
          } catch {
            // Meta file unreadable — skip
          }
        }
      }

      const totalReal = Object.values(byStatType).reduce((s, v) => s + v.real, 0);
      const totalSynthetic = Object.values(byStatType).reduce((s, v) => s + v.synthetic, 0);
      const availableModels = getAvailableModels();

      res.json({
        available_models: availableModels,
        total_real_outcomes: totalReal,
        total_synthetic_rows: totalSynthetic,
        by_stat_type: byStatType,
      });
    } catch (error: any) {
      apiLogger.error("Training status error:", error);
      res.status(500).json({ error: "Failed to fetch training status" });
    }
  });
}
