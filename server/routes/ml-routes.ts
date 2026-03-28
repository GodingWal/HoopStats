import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import type { Player } from "@shared/schema";
import { getAvailableModels, getXGBoostPrediction, type XGBoostPrediction } from "../xgboost-service";
import { ensurePlayersLoaded } from "./route-helpers";

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
}
