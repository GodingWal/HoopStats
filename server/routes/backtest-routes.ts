import type { Express } from "express";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { pool } from "../db";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import type { Player, HitRateEntry } from "@shared/schema";
import { adjustedHitRate } from "../utils/statistics";
import { analyzeEdges } from "../edge-detection";
import { loadSignalWeights, calculateSignalScore, hasStrongSignalSupport } from "../signal-scoring";
import { calibrateBet } from "../confidence-calibration";
import { batchXGBoostPredict, getAvailableModels, getXGBoostPrediction, type XGBoostPrediction } from "../xgboost-service";
import { SAMPLE_PLAYERS } from "../data/sample-players-loader";
import { ensurePlayersLoaded, parseHitRateEntry, normalCDF, getPythonCommand, getCached, setCached } from "./route-helpers";

export function registerBacktestRoutes(app: Express): void {
  app.get("/api/backtest/signals", async (req, res) => {
    try {
      const statType = (req.query.statType as string) || "Points";
      const days = parseInt(req.query.days as string) || 30;

      if (!pool) {
        return res.json({ signals: [], statType, days, message: "Database not configured" });
      }

      // Normalize legacy/alternate signal names to canonical names so data
      // from different engine versions is merged correctly.
      const result = await pool.query(`
        SELECT
          CASE signal_name
            WHEN 'usage_redistribution' THEN 'injury_alpha'
            WHEN 'positional_defense' THEN 'defense'
            WHEN 'b2b_fatigue' THEN 'b2b'
            WHEN 'pace_matchup' THEN 'pace'
            WHEN 'ref_foul' THEN 'referee'
            WHEN 'blowout_risk' THEN 'blowout'
            ELSE signal_name
          END as signal_name,
          stat_type,
          SUM(predictions_made) as total_predictions,
          SUM(correct_predictions) as total_correct,
          CASE WHEN SUM(predictions_made) > 0
            THEN ROUND(SUM(correct_predictions)::numeric / SUM(predictions_made), 4)
            ELSE 0 END as accuracy,
          SUM(over_predictions) as over_predictions,
          SUM(over_correct) as over_correct,
          SUM(under_predictions) as under_predictions,
          SUM(under_correct) as under_correct,
          ROUND(AVG(avg_error)::numeric, 2) as avg_error,
          MAX(evaluation_date) as last_evaluated
        FROM signal_performance
        WHERE stat_type = $1
          AND evaluation_date >= CURRENT_DATE - INTERVAL '1 day' * $2
        GROUP BY
          CASE signal_name
            WHEN 'usage_redistribution' THEN 'injury_alpha'
            WHEN 'positional_defense' THEN 'defense'
            WHEN 'b2b_fatigue' THEN 'b2b'
            WHEN 'pace_matchup' THEN 'pace'
            WHEN 'ref_foul' THEN 'referee'
            WHEN 'blowout_risk' THEN 'blowout'
            ELSE signal_name
          END,
          stat_type
        ORDER BY accuracy DESC
      `, [statType, days]);

      res.json({
        signals: result.rows.map(row => ({
          signalName: row.signal_name,
          statType: row.stat_type,
          totalPredictions: parseInt(row.total_predictions) || 0,
          totalCorrect: parseInt(row.total_correct) || 0,
          accuracy: parseFloat(row.accuracy) || 0,
          overPredictions: parseInt(row.over_predictions) || 0,
          overCorrect: parseInt(row.over_correct) || 0,
          underPredictions: parseInt(row.under_predictions) || 0,
          underCorrect: parseInt(row.under_correct) || 0,
          avgError: parseFloat(row.avg_error) || 0,
          lastEvaluated: row.last_evaluated,
          grade: parseFloat(row.accuracy) >= 0.65 ? 'HIGH'
            : parseFloat(row.accuracy) >= 0.55 ? 'MEDIUM'
              : parseFloat(row.accuracy) >= 0.52 ? 'LOW'
                : 'NOISE',
        })),
        statType,
        days,
      });
    } catch (error: any) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return res.json({ signals: [], statType: req.query.statType || "Points", days: 30, message: "Tables not yet created. Run migration 007." });
      }
      apiLogger.error("Error fetching signal performance:", error);
      res.status(500).json({ error: "Failed to fetch signal performance" });
    }
  });

  // Get current learned weights
  app.get("/api/backtest/weights", async (req, res) => {
    try {
      const statType = (req.query.statType as string) || "Points";

      if (!pool) {
        return res.json({ weights: null, statType, message: "Database not configured" });
      }

      const result = await pool.query(`
        SELECT
          stat_type,
          weights,
          overall_accuracy,
          sample_size,
          validation_window_days,
          calculated_at,
          valid_from
        FROM signal_weights
        WHERE stat_type = $1 AND valid_until IS NULL
        ORDER BY valid_from DESC
        LIMIT 1
      `, [statType]);

      if (result.rows.length === 0) {
        // Return default weights
        return res.json({
          weights: {
            injury_alpha: { weight: 0.20, accuracy: 0, sampleSize: 0 },
            b2b: { weight: 0.15, accuracy: 0, sampleSize: 0 },
            pace: { weight: 0.12, accuracy: 0, sampleSize: 0 },
            defense: { weight: 0.12, accuracy: 0, sampleSize: 0 },
            blowout: { weight: 0.12, accuracy: 0, sampleSize: 0 },
            home_away: { weight: 0.08, accuracy: 0, sampleSize: 0 },
            recent_form: { weight: 0.06, accuracy: 0, sampleSize: 0 },
          },
          isDefault: true,
          statType,
        });
      }

      const row = result.rows[0];
      const weightsData = typeof row.weights === 'string' ? JSON.parse(row.weights) : row.weights;

      res.json({
        weights: weightsData,
        isDefault: false,
        statType: row.stat_type,
        overallAccuracy: row.overall_accuracy,
        sampleSize: row.sample_size,
        validationWindowDays: row.validation_window_days,
        calculatedAt: row.calculated_at,
        validFrom: row.valid_from,
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ weights: null, statType: req.query.statType || "Points", message: "Tables not yet created." });
      }
      apiLogger.error("Error fetching weights:", error);
      res.status(500).json({ error: "Failed to fetch weights" });
    }
  });

  // Get recent projection logs
  app.get("/api/backtest/projections", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const statType = req.query.statType as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

      if (!pool) {
        return res.json({ projections: [], message: "Database not configured" });
      }

      let query = `
        SELECT
          id, player_name, game_date, opponent, stat_type,
          prizepicks_line, projected_value, confidence_score,
          predicted_direction, predicted_edge,
          signals, weights_used, baseline_value,
          actual_value, actual_minutes, hit_over,
          projection_hit, projection_error,
          captured_at, game_completed_at
        FROM projection_logs
        WHERE game_date >= CURRENT_DATE - INTERVAL '1 day' * $1
      `;
      const params: any[] = [days];

      if (statType) {
        params.push(statType);
        query += ` AND stat_type = $${params.length}`;
      }

      query += ` ORDER BY game_date DESC, player_name LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);

      res.json({
        projections: result.rows.map(row => ({
          id: row.id,
          playerName: row.player_name,
          gameDate: row.game_date,
          opponent: row.opponent,
          statType: row.stat_type,
          line: row.prizepicks_line,
          projectedValue: row.projected_value,
          confidenceScore: row.confidence_score,
          predictedDirection: row.predicted_direction,
          predictedEdge: row.predicted_edge,
          signals: typeof row.signals === 'string' ? JSON.parse(row.signals) : row.signals,
          weightsUsed: typeof row.weights_used === 'string' ? JSON.parse(row.weights_used) : row.weights_used,
          baselineValue: row.baseline_value,
          actualValue: row.actual_value,
          actualMinutes: row.actual_minutes,
          hitOver: row.hit_over,
          projectionHit: row.projection_hit,
          projectionError: row.projection_error,
          capturedAt: row.captured_at,
          gameCompletedAt: row.game_completed_at,
        })),
        days,
        statType: statType || 'all',
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ projections: [], message: "Tables not yet created." });
      }
      apiLogger.error("Error fetching projections:", error);
      res.status(500).json({ error: "Failed to fetch projections" });
    }
  });

  // Get backtest run history
  app.get("/api/backtest/runs", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

      if (!pool) {
        return res.json({ runs: [], message: "Database not configured" });
      }

      const result = await pool.query(`
        SELECT
          id, stat_type, days_evaluated, start_date, end_date,
          total_predictions, correct_predictions, overall_accuracy,
          signal_breakdown,
          run_started_at, run_completed_at, notes
        FROM backtest_runs
        ORDER BY run_started_at DESC
        LIMIT $1
      `, [limit]);

      res.json({
        runs: result.rows.map(row => ({
          id: row.id,
          statType: row.stat_type,
          daysEvaluated: row.days_evaluated,
          startDate: row.start_date,
          endDate: row.end_date,
          totalPredictions: row.total_predictions,
          correctPredictions: row.correct_predictions,
          overallAccuracy: row.overall_accuracy,
          signalBreakdown: typeof row.signal_breakdown === 'string'
            ? JSON.parse(row.signal_breakdown)
            : row.signal_breakdown,
          runStartedAt: row.run_started_at,
          runCompletedAt: row.run_completed_at,
          notes: row.notes,
        })),
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ runs: [], message: "Tables not yet created." });
      }
      apiLogger.error("Error fetching backtest runs:", error);
      res.status(500).json({ error: "Failed to fetch backtest runs" });
    }
  });

  // Get backtest overview stats (aggregate summary)
  app.get("/api/backtest/overview", async (req, res) => {
    try {
      if (!pool) {
        return res.json({
          totalProjections: 0,
          completedProjections: 0,
          overallHitRate: 0,
          avgConfidence: 0,
          avgError: 0,
          byStatType: {},
          recentAccuracy: [],
          message: "Database not configured",
        });
      }

      // Overall projection stats
      const projStats = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(actual_value) as completed,
          COUNT(CASE WHEN projection_hit = true THEN 1 END) as hits,
          AVG(confidence_score) as avg_confidence,
          AVG(ABS(projection_error)) as avg_error
        FROM projection_logs
      `);

      // By stat type
      const byStatType = await pool.query(`
        SELECT
          stat_type,
          COUNT(*) as total,
          COUNT(actual_value) as completed,
          COUNT(CASE WHEN projection_hit = true THEN 1 END) as hits,
          AVG(confidence_score) as avg_confidence,
          AVG(ABS(projection_error)) as avg_error
        FROM projection_logs
        GROUP BY stat_type
      `);

      // Daily accuracy trend (last 30 days)
      const dailyAccuracy = await pool.query(`
        SELECT
          game_date as date,
          COUNT(*) as total,
          COUNT(CASE WHEN projection_hit = true THEN 1 END) as hits,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(CASE WHEN projection_hit = true THEN 1 END)::numeric / COUNT(*), 4)
            ELSE 0 END as accuracy
        FROM projection_logs
        WHERE actual_value IS NOT NULL
          AND game_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY game_date
        ORDER BY game_date
      `);

      // Check for stale data - projections missing actuals for games that should be complete
      // (games from yesterday or earlier)
      const staleActualsResult = await pool.query(`
        SELECT COUNT(*) as pending_count
        FROM projection_logs
        WHERE actual_value IS NULL
          AND game_date < CURRENT_DATE
      `);
      const pendingActuals = parseInt(staleActualsResult.rows[0]?.pending_count) || 0;

      // Check when validation was last run
      const lastValidationResult = await pool.query(`
        SELECT MAX(evaluation_date) as last_date
        FROM signal_performance
      `);
      const lastValidationDate = lastValidationResult.rows[0]?.last_date;

      const stats = projStats.rows[0];
      const total = parseInt(stats.total) || 0;
      const completed = parseInt(stats.completed) || 0;
      const hits = parseInt(stats.hits) || 0;

      // Data is stale if: no projections exist yet, there are pending actuals, OR validation hasn't run recently
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const validationStale = !lastValidationDate || lastValidationDate < today;
      const needsRefresh = total === 0 || pendingActuals > 0 || validationStale;

      res.json({
        totalProjections: total,
        completedProjections: completed,
        overallHitRate: completed > 0 ? hits / completed : 0,
        avgConfidence: parseFloat(stats.avg_confidence) || 0,
        avgError: parseFloat(stats.avg_error) || 0,
        byStatType: Object.fromEntries(
          byStatType.rows.map(row => [
            row.stat_type,
            {
              total: parseInt(row.total) || 0,
              completed: parseInt(row.completed) || 0,
              hits: parseInt(row.hits) || 0,
              hitRate: parseInt(row.completed) > 0
                ? parseInt(row.hits) / parseInt(row.completed) : 0,
              avgConfidence: parseFloat(row.avg_confidence) || 0,
              avgError: parseFloat(row.avg_error) || 0,
            }
          ])
        ),
        recentAccuracy: dailyAccuracy.rows.map(row => ({
          date: row.date,
          total: parseInt(row.total),
          hits: parseInt(row.hits),
          accuracy: parseFloat(row.accuracy),
        })),
        // Staleness info for auto-refresh
        staleness: {
          pendingActuals,
          validationStale,
          lastValidationDate,
          needsRefresh,
        },
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({
          totalProjections: 0,
          completedProjections: 0,
          overallHitRate: 0,
          avgConfidence: 0,
          avgError: 0,
          byStatType: {},
          recentAccuracy: [],
          message: "Tables not yet created. Run migration 007.",
        });
      }
      apiLogger.error("Error fetching backtest overview:", error);
      res.status(500).json({ error: "Failed to fetch backtest overview" });
    }
  });

  // =============== BACKTEST AUTO-REFRESH ENDPOINTS ===============

  // Store refresh state to prevent concurrent refreshes
  let isRefreshing = false;
  let lastRefreshTime: Date | null = null;
  let lastRefreshResult: any = null;

  // POST /api/backtest/refresh - Trigger full data refresh (actuals + validation)
  app.post("/api/backtest/refresh", async (req, res) => {
    // Prevent concurrent refreshes
    if (isRefreshing) {
      return res.status(409).json({
        error: "Refresh already in progress",
        lastRefreshTime: lastRefreshTime?.toISOString(),
      });
    }

    // Rate limit - only allow refresh every 5 minutes
    const minInterval = 5 * 60 * 1000; // 5 minutes
    if (lastRefreshTime && (Date.now() - lastRefreshTime.getTime()) < minInterval) {
      return res.json({
        status: "skipped",
        message: "Refresh was run recently",
        lastRefreshTime: lastRefreshTime.toISOString(),
        lastResult: lastRefreshResult,
      });
    }

    isRefreshing = true;
    const startTime = Date.now();
    apiLogger.info("[Backtest Refresh] Starting auto-refresh...");

    try {
      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "scripts", "cron_jobs.py");

      // Run actuals first, then validation
      const runPythonScript = (command: string): Promise<{ success: boolean; output: string; error: string }> => {
        return new Promise((resolve) => {
          const pythonProcess = spawn(getPythonCommand(), [scriptPath, command]);
          let stdout = "";
          let stderr = "";

          pythonProcess.stdout.on("data", (data) => {
            stdout += data.toString();
          });

          pythonProcess.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          pythonProcess.on("close", (code) => {
            resolve({
              success: code === 0,
              output: stdout,
              error: stderr,
            });
          });

          pythonProcess.on("error", (err) => {
            resolve({
              success: false,
              output: "",
              error: err.message,
            });
          });
        });
      };

      // Step 1: Capture today's projections (ensures new data flows in)
      apiLogger.info("[Backtest Refresh] Running projection capture...");
      const captureResult = await runPythonScript("capture");

      // Step 2: Populate actuals for yesterday's games
      apiLogger.info("[Backtest Refresh] Running actuals population...");
      const actualsResult = await runPythonScript("actuals");

      // Step 3: Run validation
      apiLogger.info("[Backtest Refresh] Running validation...");
      const validationResult = await runPythonScript("validate");

      const duration = Date.now() - startTime;
      lastRefreshTime = new Date();
      lastRefreshResult = {
        capture: {
          success: captureResult.success,
          message: captureResult.output.trim() || (captureResult.success ? "Completed" : captureResult.error),
        },
        actuals: {
          success: actualsResult.success,
          message: actualsResult.output.trim() || (actualsResult.success ? "Completed" : actualsResult.error),
        },
        validation: {
          success: validationResult.success,
          message: validationResult.output.trim() || (validationResult.success ? "Completed" : validationResult.error),
        },
        duration: `${Number((duration / 1000).toFixed(1))}s`,
      };

      apiLogger.info(`[Backtest Refresh] Completed in ${lastRefreshResult.duration}`);

      res.json({
        status: "completed",
        refreshTime: lastRefreshTime.toISOString(),
        result: lastRefreshResult,
      });
    } catch (error: any) {
      apiLogger.error("[Backtest Refresh] Error:", error);
      lastRefreshResult = { error: error.message };
      res.status(500).json({
        status: "error",
        error: error.message,
      });
    } finally {
      isRefreshing = false;
    }
  });

  // GET /api/backtest/refresh/status - Check refresh status
  app.get("/api/backtest/refresh/status", (req, res) => {
    res.json({
      isRefreshing,
      lastRefreshTime: lastRefreshTime?.toISOString() || null,
      lastResult: lastRefreshResult,
    });
  });

  // =============== XGBOOST BACKTEST ENDPOINTS ===============

  // GET /api/backtest/xgboost-overview — training data stats + hit rates by stat type
  app.get("/api/backtest/xgboost-overview", async (req, res) => {
    try {
      if (!pool) {
        return res.json({ total: 0, labeled: 0, unlabeled: 0, hitRate: null, byStatType: {}, dailyAccuracy: [] });
      }

      // Overall stats
      const overall = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(actual_value) as labeled,
          COUNT(*) - COUNT(actual_value) as unlabeled,
          CASE WHEN COUNT(actual_value) > 0
            THEN ROUND(AVG(CASE WHEN hit THEN 1.0 ELSE 0.0 END)::numeric, 4)
            ELSE NULL END as hit_rate,
          AVG(edge_total) as avg_edge_total,
          AVG(signal_score) as avg_signal_score
        FROM xgboost_training_log
      `);

      // By stat type
      const byStatResult = await pool.query(`
        SELECT
          stat_type,
          COUNT(*) as total,
          COUNT(actual_value) as labeled,
          COUNT(CASE WHEN hit = true THEN 1 END) as hits,
          CASE WHEN COUNT(actual_value) > 0
            THEN ROUND(COUNT(CASE WHEN hit = true THEN 1 END)::numeric / COUNT(actual_value), 4)
            ELSE NULL END as hit_rate,
          AVG(edge_total) as avg_edge
        FROM xgboost_training_log
        GROUP BY stat_type
        ORDER BY COUNT(*) DESC
      `);

      // Daily accuracy trend (last 30 days, only settled)
      const dailyResult = await pool.query(`
        SELECT
          game_date as date,
          COUNT(*) as total,
          COUNT(CASE WHEN hit = true THEN 1 END) as hits,
          CASE WHEN COUNT(*) > 0
            THEN ROUND(COUNT(CASE WHEN hit = true THEN 1 END)::numeric / COUNT(*), 4)
            ELSE 0 END as accuracy
        FROM xgboost_training_log
        WHERE actual_value IS NOT NULL
          AND game_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY game_date
        ORDER BY game_date
      `);

      // Confidence tier breakdown
      const tierResult = await pool.query(`
        SELECT
          confidence_tier,
          COUNT(*) as total,
          COUNT(actual_value) as labeled,
          COUNT(CASE WHEN hit = true THEN 1 END) as hits,
          CASE WHEN COUNT(actual_value) > 0
            THEN ROUND(COUNT(CASE WHEN hit = true THEN 1 END)::numeric / COUNT(actual_value), 4)
            ELSE NULL END as hit_rate
        FROM xgboost_training_log
        WHERE confidence_tier IS NOT NULL
        GROUP BY confidence_tier
        ORDER BY COUNT(*) DESC
      `);

      const row = overall.rows[0];
      res.json({
        total: parseInt(row.total) || 0,
        labeled: parseInt(row.labeled) || 0,
        unlabeled: parseInt(row.unlabeled) || 0,
        hitRate: row.hit_rate ? parseFloat(row.hit_rate) : null,
        avgEdgeTotal: parseFloat(row.avg_edge_total) || 0,
        avgSignalScore: parseFloat(row.avg_signal_score) || 0,
        byStatType: Object.fromEntries(
          byStatResult.rows.map(r => [r.stat_type, {
            total: parseInt(r.total) || 0,
            labeled: parseInt(r.labeled) || 0,
            hits: parseInt(r.hits) || 0,
            hitRate: r.hit_rate ? parseFloat(r.hit_rate) : null,
            avgEdge: parseFloat(r.avg_edge) || 0,
          }])
        ),
        dailyAccuracy: dailyResult.rows.map(r => ({
          date: r.date,
          total: parseInt(r.total),
          hits: parseInt(r.hits),
          accuracy: parseFloat(r.accuracy),
        })),
        byConfidenceTier: tierResult.rows.map(r => ({
          tier: r.confidence_tier,
          total: parseInt(r.total) || 0,
          labeled: parseInt(r.labeled) || 0,
          hits: parseInt(r.hits) || 0,
          hitRate: r.hit_rate ? parseFloat(r.hit_rate) : null,
        })),
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ total: 0, labeled: 0, unlabeled: 0, hitRate: null, byStatType: {}, dailyAccuracy: [], byConfidenceTier: [], message: "Table not yet created." });
      }
      apiLogger.error("Error fetching XGBoost overview:", error);
      res.status(500).json({ error: "Failed to fetch XGBoost overview" });
    }
  });

  // GET /api/backtest/xgboost-predictions — recent predictions with outcomes
  app.get("/api/backtest/xgboost-predictions", async (req, res) => {
    try {
      if (!pool) return res.json({ predictions: [] });

      const statType = req.query.statType as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const days = parseInt(req.query.days as string) || 14;

      let query = `
        SELECT
          id, player_id, game_date, stat_type, line_value,
          signal_score, edge_total, predicted_direction, confidence_tier,
          actual_value, actual_minutes, hit,
          closing_line, closing_line_value,
          model_prob, calibration_method, shap_top_drivers,
          captured_at, settled_at
        FROM xgboost_training_log
        WHERE game_date >= CURRENT_DATE - INTERVAL '${days} days'
      `;
      const params: unknown[] = [];
      if (statType) {
        params.push(statType);
        query += ` AND stat_type = $${params.length}`;
      }
      query += ` ORDER BY game_date DESC, captured_at DESC LIMIT ${limit}`;

      const result = await pool.query(query, params);
      res.json({
        predictions: result.rows.map(r => ({
          id: r.id,
          playerId: r.player_id,
          gameDate: r.game_date,
          statType: r.stat_type,
          lineValue: parseFloat(r.line_value),
          signalScore: parseFloat(r.signal_score) || 0,
          edgeTotal: parseFloat(r.edge_total) || 0,
          predictedDirection: r.predicted_direction,
          confidenceTier: r.confidence_tier,
          actualValue: r.actual_value !== null ? parseFloat(r.actual_value) : null,
          actualMinutes: r.actual_minutes !== null ? parseFloat(r.actual_minutes) : null,
          hit: r.hit,
          closingLine: r.closing_line !== null ? parseFloat(r.closing_line) : null,
          closingLineValue: r.closing_line_value !== null ? parseFloat(r.closing_line_value) : null,
          modelProb: r.model_prob !== null ? parseFloat(r.model_prob) : null,
          calibrationMethod: r.calibration_method || null,
          shapTopDrivers: r.shap_top_drivers || null,
          capturedAt: r.captured_at,
          settledAt: r.settled_at,
        })),
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ predictions: [], message: "Table not yet created." });
      }
      apiLogger.error("Error fetching XGBoost predictions:", error);
      res.status(500).json({ error: "Failed to fetch XGBoost predictions" });
    }
  });

  // GET /api/backtest/xgboost-features — aggregate feature importance from logged data
  app.get("/api/backtest/xgboost-features", async (req, res) => {
    try {
      if (!pool) return res.json({ features: [] });

      const statType = req.query.statType as string | undefined;

      // Get a sample of settled predictions with features to compute correlations
      let query = `
        SELECT features, hit
        FROM xgboost_training_log
        WHERE actual_value IS NOT NULL AND features IS NOT NULL
      `;
      const params: unknown[] = [];
      if (statType) {
        params.push(statType);
        query += ` AND stat_type = $${params.length}`;
      }
      query += ` ORDER BY game_date DESC LIMIT 500`;

      const result = await pool.query(query, params);

      if (result.rows.length < 10) {
        return res.json({ features: [], sampleSize: result.rows.length, message: "Insufficient data for feature analysis" });
      }

      // Compute mean feature values for hits vs misses
      const hitFeatures: Record<string, number[]> = {};
      const missFeatures: Record<string, number[]> = {};

      for (const row of result.rows) {
        const features = typeof row.features === 'string' ? JSON.parse(row.features) : row.features;
        const bucket = row.hit ? hitFeatures : missFeatures;

        for (const [key, val] of Object.entries(features)) {
          if (typeof val === 'number' && !isNaN(val)) {
            if (!bucket[key]) bucket[key] = [];
            bucket[key].push(val);
          }
        }
      }

      // Compute feature importance as abs(mean_hit - mean_miss) normalized
      const allKeys = new Set([...Object.keys(hitFeatures), ...Object.keys(missFeatures)]);
      const featureImportance: Array<{ name: string; importance: number; hitMean: number; missMean: number; diff: number }> = [];

      for (const key of allKeys) {
        const hitVals = hitFeatures[key] || [];
        const missVals = missFeatures[key] || [];
        const hitMean = hitVals.length > 0 ? hitVals.reduce((a, b) => a + b, 0) / hitVals.length : 0;
        const missMean = missVals.length > 0 ? missVals.reduce((a, b) => a + b, 0) / missVals.length : 0;
        const diff = hitMean - missMean;

        // Normalize importance by pooled std
        const allVals = [...hitVals, ...missVals];
        const mean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
        const std = Math.sqrt(allVals.reduce((s, v) => s + (v - mean) ** 2, 0) / allVals.length) || 1;
        const importance = Math.abs(diff) / std;

        featureImportance.push({ name: key, importance, hitMean, missMean, diff });
      }

      // Sort by importance
      featureImportance.sort((a, b) => b.importance - a.importance);

      res.json({
        features: featureImportance.slice(0, 20),
        sampleSize: result.rows.length,
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ features: [], sampleSize: 0, message: "Table not yet created." });
      }
      apiLogger.error("Error fetching XGBoost features:", error);
      res.status(500).json({ error: "Failed to fetch XGBoost features" });
    }
  });


  // =============== VALIDATION & EVALUATION METRICS ENDPOINTS ===============

  // GET /api/backtest/evaluation-metrics — Brier score, ECE, log-loss, CLV for settled predictions
  app.get("/api/backtest/evaluation-metrics", async (req, res) => {
    try {
      if (!pool) return res.json({ metrics: null, message: "No database" });

      const statType = req.query.statType as string | undefined;
      const days = parseInt(req.query.days as string) || 30;

      let query = `
        SELECT
          stat_type,
          model_prob,
          hit,
          line,
          closing_line,
          over_odds,
          under_odds,
          actual_value
        FROM xgboost_training_log
        WHERE actual_value IS NOT NULL
          AND model_prob IS NOT NULL
          AND game_date >= NOW() - INTERVAL '${days} days'
      `;
      const params: unknown[] = [];
      if (statType) {
        params.push(statType);
        query += ` AND stat_type = $${params.length}`;
      }
      query += ` ORDER BY game_date DESC`;

      const result = await pool.query(query, params);

      if (result.rows.length < 5) {
        return res.json({
          metrics: null,
          sampleSize: result.rows.length,
          message: "Insufficient settled predictions for evaluation",
        });
      }

      const rows = result.rows;
      const probs = rows.map((r: any) => parseFloat(r.model_prob));
      const outcomes = rows.map((r: any) => r.hit ? 1.0 : 0.0);

      // Brier Score
      const brierScore = probs.reduce((sum: number, p: number, i: number) =>
        sum + (p - outcomes[i]) ** 2, 0) / probs.length;

      // Log Loss
      const eps = 1e-15;
      const logLoss = -probs.reduce((sum: number, p: number, i: number) => {
        const clipped = Math.max(eps, Math.min(1 - eps, p));
        return sum + outcomes[i] * Math.log(clipped) + (1 - outcomes[i]) * Math.log(1 - clipped);
      }, 0) / probs.length;

      // ECE (Expected Calibration Error)
      const nBins = 10;
      let ece = 0;
      const calibrationBins: Array<{ binRange: string; predicted: number; actual: number; count: number }> = [];
      for (let bin = 0; bin < nBins; bin++) {
        const low = bin / nBins;
        const high = (bin + 1) / nBins;
        const inBin = probs.map((p: number, i: number) => ({p, o: outcomes[i]}))
          .filter((x: {p: number; o: number}) => x.p >= low && x.p < high);
        if (inBin.length === 0) {
          calibrationBins.push({ binRange: `${Number((low*100).toFixed(0))}-${Number((high*100).toFixed(0))}%`, predicted: 0, actual: 0, count: 0 });
          continue;
        }
        const avgPred = inBin.reduce((s: number, x: {p: number; o: number}) => s + x.p, 0) / inBin.length;
        const avgTrue = inBin.reduce((s: number, x: {p: number; o: number}) => s + x.o, 0) / inBin.length;
        ece += (inBin.length / probs.length) * Math.abs(avgTrue - avgPred);
        calibrationBins.push({
          binRange: `${Number((low*100).toFixed(0))}-${Number((high*100).toFixed(0))}%`,
          predicted: Math.round(avgPred * 1000) / 1000,
          actual: Math.round(avgTrue * 1000) / 1000,
          count: inBin.length,
        });
      }

      // CLV metrics
      const withClosing = rows.filter((r: any) => r.closing_line != null && r.line != null);
      let avgClv = 0;
      let clvPositiveRate = 0;
      if (withClosing.length > 0) {
        const clvValues = withClosing.map((r: any) => {
          const modelProb = parseFloat(r.model_prob);
          const opening = parseFloat(r.line);
          const closing = parseFloat(r.closing_line);
          if (modelProb > 0.5) return opening - closing;
          return closing - opening;
        });
        avgClv = clvValues.reduce((a: number, b: number) => a + b, 0) / clvValues.length;
        clvPositiveRate = clvValues.filter((c: number) => c > 0).length / clvValues.length;
      }

      // Per-stat breakdown
      const statBreakdown: Record<string, any> = {};
      const byStatType = rows.reduce((acc: Record<string, any[]>, r: any) => {
        const st = r.stat_type;
        if (!acc[st]) acc[st] = [];
        acc[st].push(r);
        return acc;
      }, {} as Record<string, any[]>);

      for (const [st, statRows] of Object.entries(byStatType) as [string, any[]][]) {
        const sp = statRows.map((r: any) => parseFloat(r.model_prob));
        const so = statRows.map((r: any) => r.hit ? 1.0 : 0.0);
        const statBrier = sp.reduce((sum: number, p: number, i: number) =>
          sum + (p - so[i]) ** 2, 0) / sp.length;
        const wins = so.filter((o: number) => o === 1).length;
        statBreakdown[st] = {
          count: statRows.length,
          hitRate: wins / statRows.length,
          brierScore: Math.round(statBrier * 10000) / 10000,
          roi: statRows.reduce((s: number, r: any) => {
            return s + (r.hit ? 0.909 : -1.0); // -110 odds
          }, 0) / statRows.length,
        };
      }

      res.json({
        metrics: {
          brierScore: Math.round(brierScore * 10000) / 10000,
          logLoss: Math.round(logLoss * 10000) / 10000,
          ece: Math.round(ece * 10000) / 10000,
          avgClv: Math.round(avgClv * 1000) / 1000,
          clvPositiveRate: Math.round(clvPositiveRate * 1000) / 1000,
          hitRate: outcomes.filter((o: number) => o === 1).length / outcomes.length,
          calibrationBins,
          statBreakdown,
        },
        sampleSize: rows.length,
        clvSampleSize: withClosing.length,
        days,
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ metrics: null, sampleSize: 0, message: "Table not yet created." });
      }
      apiLogger.error("Error fetching evaluation metrics:", error);
      res.status(500).json({ error: "Failed to fetch evaluation metrics" });
    }
  });

  // GET /api/backtest/market-comparison — Compare model vs market consensus
  app.get("/api/backtest/market-comparison", async (req, res) => {
    try {
      if (!pool) return res.json({ comparison: null, message: "No database" });

      const days = parseInt(req.query.days as string) || 7;

      // Get model projections
      const projQuery = `
        SELECT
          pl.player_id, pl.player_name, pl.stat_type, pl.game_date,
          pl.projected_value, pl.line, pl.actual_value, pl.projection_hit
        FROM projection_logs pl
        WHERE pl.game_date >= NOW() - INTERVAL '${days} days'
          AND pl.projected_value IS NOT NULL
        ORDER BY pl.game_date DESC
      `;

      // Get market consensus from multi-book lines (median line = market projection)
      const marketQuery = `
        SELECT
          player_id, stat as stat_type, game_date,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY line) as market_line,
          COUNT(DISTINCT sportsbook_key) as num_books,
          MAX(line) - MIN(line) as line_spread
        FROM player_prop_lines
        WHERE game_date >= NOW() - INTERVAL '${days} days'
          AND line IS NOT NULL
        GROUP BY player_id, stat, game_date
      `;

      const [projResult, marketResult] = await Promise.all([
        pool.query(projQuery),
        pool.query(marketQuery),
      ]);

      if (projResult.rows.length === 0) {
        return res.json({
          comparison: null,
          message: "No projection data available for comparison",
        });
      }

      // Build market lookup
      const marketMap = new Map<string, any>();
      for (const row of marketResult.rows) {
        const key = `${row.player_id}_${row.stat_type}_${row.game_date}`;
        marketMap.set(key, row);
      }

      // Find disagreements
      const disagreements: any[] = [];
      let totalCompared = 0;
      let modelCloserCount = 0;
      let totalWithActuals = 0;

      for (const proj of projResult.rows) {
        const key = `${proj.player_id}_${proj.stat_type}_${proj.game_date}`;
        const market = marketMap.get(key);
        if (!market) continue;

        totalCompared++;
        const modelVal = parseFloat(proj.projected_value);
        const marketVal = parseFloat(market.market_line);
        const line = parseFloat(proj.line) || marketVal;
        const diff = modelVal - marketVal;
        const diffPct = line > 0 ? Math.abs(diff / line) * 100 : 0;

        const modelSide = modelVal > line ? "OVER" : "UNDER";
        const marketSide = marketVal > line ? "OVER" : "UNDER";

        // Track accuracy if actual is available
        let modelCorrect = null;
        let marketCorrect = null;
        if (proj.actual_value != null) {
          const actual = parseFloat(proj.actual_value);
          const modelErr = Math.abs(modelVal - actual);
          const marketErr = Math.abs(marketVal - actual);
          if (modelErr < marketErr) modelCloserCount++;
          totalWithActuals++;

          modelCorrect = (modelSide === "OVER" && actual > line) || (modelSide === "UNDER" && actual < line);
          marketCorrect = (marketSide === "OVER" && actual > line) || (marketSide === "UNDER" && actual < line);
        }

        if (diffPct >= 3.0) { // 3% minimum disagreement threshold
          disagreements.push({
            playerName: proj.player_name,
            statType: proj.stat_type,
            gameDate: proj.game_date,
            modelProjection: modelVal,
            marketConsensus: marketVal,
            line,
            difference: Math.round(diff * 100) / 100,
            differencePct: Math.round(diffPct * 10) / 10,
            modelSide,
            marketSide,
            sidesAgree: modelSide === marketSide,
            numBooks: parseInt(market.num_books),
            lineSpread: parseFloat(market.line_spread),
            actualValue: proj.actual_value ? parseFloat(proj.actual_value) : null,
            modelCorrect,
            marketCorrect,
            inefficiencyScore: Math.round((diffPct * 0.6 + (line > 0 ? Math.abs(modelVal - line) / line * 100 * 0.4 : 0)) * 10) / 10,
          });
        }
      }

      // Sort by inefficiency score
      disagreements.sort((a: any, b: any) => b.inefficiencyScore - a.inefficiencyScore);

      res.json({
        comparison: {
          totalCompared,
          totalDisagreements: disagreements.length,
          agreementRate: totalCompared > 0 ? Math.round((1 - disagreements.length / totalCompared) * 1000) / 1000 : 1.0,
          modelCloserToActualRate: totalWithActuals > 0 ? Math.round(modelCloserCount / totalWithActuals * 1000) / 1000 : null,
          totalWithActuals,
          topDisagreements: disagreements.slice(0, 25),
        },
        days,
      });
    } catch (error: any) {
      if (error.code === '42P01') {
        return res.json({ comparison: null, message: "Required tables not yet created." });
      }
      apiLogger.error("Error fetching market comparison:", error);
      res.status(500).json({ error: "Failed to fetch market comparison" });
    }
  });

  // GET /api/backtest/devig-odds — Calculate no-vig fair odds for a two-way market
  app.get("/api/backtest/devig-odds", async (req, res) => {
    try {
      const overOdds = parseInt(req.query.overOdds as string) || -110;
      const underOdds = parseInt(req.query.underOdds as string) || -110;

      const impliedOver = overOdds < 0
        ? Math.abs(overOdds) / (Math.abs(overOdds) + 100)
        : 100 / (overOdds + 100);
      const impliedUnder = underOdds < 0
        ? Math.abs(underOdds) / (Math.abs(underOdds) + 100)
        : 100 / (underOdds + 100);

      const totalImplied = impliedOver + impliedUnder;
      const vig = totalImplied - 1.0;
      const vigPct = vig * 100;

      // Multiplicative devig (most common method)
      const fairOver = impliedOver / totalImplied;
      const fairUnder = impliedUnder / totalImplied;

      res.json({
        input: { overOdds, underOdds },
        implied: {
          over: Math.round(impliedOver * 10000) / 10000,
          under: Math.round(impliedUnder * 10000) / 10000,
          total: Math.round(totalImplied * 10000) / 10000,
        },
        vig: {
          amount: Math.round(vig * 10000) / 10000,
          percentage: Math.round(vigPct * 100) / 100,
        },
        fairProbability: {
          over: Math.round(fairOver * 10000) / 10000,
          under: Math.round(fairUnder * 10000) / 10000,
        },
        breakeven: {
          over: Math.round(fairOver * 10000) / 100,
          under: Math.round(fairUnder * 10000) / 100,
        },
      });
    } catch (error) {
      apiLogger.error("Error calculating devig odds:", error);
      res.status(500).json({ error: "Failed to calculate devig odds" });
    }
  });

  // -------------------------------------------------------------------------
  // Signal Engine API Endpoints
  // -------------------------------------------------------------------------

  app.get("/api/backtest", async (req, res) => {
    try {
      const signal = (req.query.signal as string) || null;
      const days = parseInt((req.query.days as string) || "90", 10);

      const cacheKey = `backtest_${signal}_${days}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      let query: string;
      let params: any[];

      if (signal) {
        query = `
          SELECT
            game_date,
            signal_type,
            COUNT(*) AS plays,
            COUNT(*) FILTER (WHERE outcome = true) AS wins,
            ROUND(COUNT(*) FILTER (WHERE outcome = true)::numeric / NULLIF(COUNT(*), 0), 4) AS hit_rate,
            ROUND(AVG(clv), 2) AS avg_clv,
            ROUND(AVG(edge_pct), 2) AS avg_edge,
            SUM(CASE WHEN outcome = true THEN 0.85 ELSE -1 END) AS daily_units
          FROM signal_results
          WHERE signal_type = $1
            AND game_date >= NOW() - $2 * INTERVAL '1 day'
            AND outcome IS NOT NULL
          GROUP BY game_date, signal_type
          ORDER BY game_date ASC`;
        params = [signal, days];
      } else {
        query = `
          SELECT
            game_date,
            signal_type,
            COUNT(*) AS plays,
            COUNT(*) FILTER (WHERE outcome = true) AS wins,
            ROUND(COUNT(*) FILTER (WHERE outcome = true)::numeric / NULLIF(COUNT(*), 0), 4) AS hit_rate,
            ROUND(AVG(clv), 2) AS avg_clv,
            SUM(CASE WHEN outcome = true THEN 0.85 ELSE -1 END) AS daily_units
          FROM signal_results
          WHERE game_date >= NOW() - $1 * INTERVAL '1 day'
            AND outcome IS NOT NULL
          GROUP BY game_date, signal_type
          ORDER BY game_date ASC, signal_type`;
        params = [days];
      }

      const result = await pool.query(query, params);

      // Compute cumulative units per signal
      const bySignal: Record<string, any[]> = {};
      for (const row of result.rows) {
        if (!bySignal[row.signal_type]) bySignal[row.signal_type] = [];
        bySignal[row.signal_type].push(row);
      }

      // Add cumulative_units column
      for (const rows of Object.values(bySignal)) {
        let cumUnits = 0;
        for (const row of rows) {
          cumUnits += parseFloat(row.daily_units || "0");
          row.cumulative_units = Number(cumUnits.toFixed(2));
        }
      }

      // Summary stats
      const summaryResult = await pool.query(
        `SELECT
           signal_type,
           COUNT(*) AS total_plays,
           ROUND(COUNT(*) FILTER (WHERE outcome = true)::numeric / NULLIF(COUNT(*), 0), 4) AS hit_rate,
           ROUND(AVG(clv), 2) AS avg_clv,
           ROUND(SUM(CASE WHEN outcome = true THEN 0.85 ELSE -1 END), 2) AS total_units
         FROM signal_results
         WHERE ${signal ? "signal_type = $1 AND" : ""} game_date >= NOW() - ${signal ? "$2" : "$1"} * INTERVAL '1 day'
           AND outcome IS NOT NULL
         GROUP BY signal_type
         ORDER BY total_units DESC`,
        signal ? [signal, days] : [days]
      );

      const data = {
        daily: result.rows,
        by_signal: bySignal,
        summary: summaryResult.rows,
        signal,
        days,
      };
      setCached(cacheKey, data);
      res.json({ ...data, cached: false });
    } catch (error: any) {
      apiLogger.error("[Backtest] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // CORRELATED PARLAY ENDPOINTS
  // =========================================================================

  /**
   * GET /api/correlated-parlays?date=YYYY-MM-DD&size=2&min_ev=0.05&limit=20
   * Returns top correlated parlay recommendations from parlay_results.
   */
}
