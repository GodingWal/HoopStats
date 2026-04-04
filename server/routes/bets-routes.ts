import type { Express } from "express";
import { spawn } from "child_process";
import path from "path";
import { storage } from "../storage";
import { pool } from "../db";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import type { Player } from "@shared/schema";
import { loadSignalWeights, calculateSignalScore, getSignalDescription } from "../signal-scoring";
import { parseBetScreenshot } from "../services/openai";
import { batchXGBoostPredict } from "../xgboost-service";
import { ensurePlayersLoaded, generateBetsFromPrizePicks, enrichBetsWithCalibration, getPythonCommand } from "./route-helpers";


// Track when bets were last refreshed so GET can detect staleness
let lastBetsRefreshTime = 0;
const BETS_STALE_MS = 20 * 60 * 1000; // 20 minutes - auto-refresh if older
const AUTO_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function registerBetsRoutes(app: Express): void {
  app.post("/api/bets/refresh", async (req, res) => {
    try {
      apiLogger.info("Refreshing bets from PrizePicks...");

      let players = await ensurePlayersLoaded();

      let generatedBets: any[] = await generateBetsFromPrizePicks(players);
      generatedBets = await enrichBetsWithCalibration(generatedBets, players);

      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }

      
      // Persist calibration data via raw SQL (bypasses Drizzle type restrictions)
      if (pool) {
        let updatedCount = 0;
        for (const bet of generatedBets) {
          if (bet.confidence_tier) {
            try {
              await pool.query(
                `UPDATE potential_bets SET 
                  confidence_tier = $1, signal_agreement = $2, calibrated_probability = $3,
                  agreeing_signals = $4, total_signals = $5, signal_details = $6
                WHERE player_name = $7 AND stat_type = $8 AND line = $9`,
                [bet.confidence_tier, bet.signal_agreement, bet.calibrated_probability,
                 bet.agreeing_signals, bet.total_signals, JSON.stringify(bet.signal_details || []),
                 bet.player_name, bet.stat_type, Number(bet.line)]
              );
              updatedCount++;
            } catch (e: any) {
              // Ignore individual update failures
            }
          }
        }
        apiLogger.info(`[Calibration] Persisted calibration data for ${updatedCount}/${generatedBets.length} bets to DB`);
      }

      lastBetsRefreshTime = Date.now();
      apiLogger.info(`Refreshed ${generatedBets.length} bets from PrizePicks`);

      // Trigger parlay regeneration for all leg counts so parlays stay in sync
      // with today's fresh PrizePicks lines. Fire-and-forget (non-blocking).
      try {
        const targetDate = new Intl.DateTimeFormat("en-CA", {
          timeZone: "America/New_York",
        }).format(new Date());
        const pythonCmd = getPythonCommand();
        const scriptPath = path.join(
          process.cwd(),
          "server",
          "nba-prop-model",
          "scripts",
          "cron_jobs.py"
        );
        for (const size of [2, 3, 4, 5, 6]) {
          const child = spawn(pythonCmd, [
            scriptPath, "parlays", "--date", targetDate, "--size", String(size),
          ], { detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } });
          let bgStderr = "";
          child.stderr?.on("data", (d: Buffer) => { bgStderr += d.toString(); });
          child.on("close", (code: number) => {
            if (code !== 0) {
              apiLogger.error(`[Parlays] post-refresh size=${size} exited ${code}: ${bgStderr}`);
            } else {
              apiLogger.info(`[Parlays] post-refresh regeneration done for ${targetDate} size=${size}`);
            }
          });
          child.unref();
        }
        apiLogger.info("[Parlays] Triggered parlay regeneration after bets refresh");
      } catch (parlayErr: any) {
        apiLogger.warn(`[Parlays] Could not trigger regeneration after refresh: ${parlayErr.message}`);
      }

      res.json({
        success: true,
        betsCount: generatedBets.length,
        message: `Successfully refreshed ${generatedBets.length} betting opportunities from PrizePicks`
      });
    } catch (error) {
      apiLogger.error("Error refreshing bets:", error);
      res.status(500).json({
        error: "Failed to refresh bets",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Parse a screenshot of a betting slip using Claude vision
  app.post("/api/bets/upload-screenshot", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) {
        return res.status(400).json({ error: "Missing image data" });
      }

      const mediaTypeMatch = image.match(/^data:(image\/\w+);base64,/);
      const mediaType = (mediaTypeMatch?.[1] || "image/jpeg") as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      const base64Image = image.replace(/^data:image\/\w+;base64,/, "");

      const bets = await parseBetScreenshot(base64Image, mediaType);
      res.json(bets);
    } catch (error) {
      apiLogger.error("Error parsing screenshot", error);
      res.status(500).json({ error: "Failed to parse screenshot" });
    }
  });

  app.get("/api/bets", async (req, res) => {
    try {
      // Load signal weights for enrichment
      await loadSignalWeights(pool);

      let bets = await storage.getPotentialBets();
      const isStale = lastBetsRefreshTime === 0 || (Date.now() - lastBetsRefreshTime > BETS_STALE_MS);
      if (bets.length === 0 || isStale) {
        try {
          apiLogger.info("Auto-refreshing stale bets (last refresh: " + (lastBetsRefreshTime ? new Date(lastBetsRefreshTime).toISOString() : "never") + ")");
          let players = await ensurePlayersLoaded();
          let generatedBets: any[] = await generateBetsFromPrizePicks(players);
          generatedBets = await enrichBetsWithCalibration(generatedBets, players);
          await storage.clearPotentialBets();
          for (const bet of generatedBets) {
            await storage.createPotentialBet(bet);
          }
          lastBetsRefreshTime = Date.now();
          bets = await storage.getPotentialBets();
        } catch (refreshErr: any) {
          apiLogger.error("Auto-refresh failed, serving existing bets: " + refreshErr.message);
          // If refresh fails but we have existing bets, serve those
          if (bets.length === 0) {
            return res.status(503).json({ error: "No bets available and refresh failed" });
          }
        }
      }


      
      // --- Calibration enrichment (ensure tiers are present) ---
      try {
        const players = await ensurePlayersLoaded();
        const betsAsAny = bets as any[];
        if (betsAsAny.length > 0 && !betsAsAny[0].confidence_tier) {
          const enriched = await enrichBetsWithCalibration(betsAsAny, players);
          bets = enriched as any;
          apiLogger.info(`[Calibration] GET enriched ${bets.length} bets`);
        }
      } catch (calErr: any) {
        apiLogger.error(`[Calibration] GET enrichment failed: ${calErr.message}`);
      }

      // --- XGBoost / SHAP enrichment ---
      apiLogger.info("Starting XGBoost/SHAP enrichment for " + bets.length + " bets");
      try {
        const players = await ensurePlayersLoaded();
        const playerMap = new Map<string, Player>();
        for (const p of players) {
          playerMap.set(p.player_name.toLowerCase(), p);
        }

        // Build batch request for XGBoost
        const xgbRequests: Array<{ player: Player; statType: string; line: number }> = [];
        const betIndices: number[] = [];
        for (let i = 0; i < bets.length; i++) {
          const bet = bets[i];
          const player = playerMap.get((bet.player_name || "").toLowerCase());
          if (player && bet.stat_type && bet.line) {
            // Only request for stat types XGBoost supports
            const supportedStats = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "TOV"];
            if (supportedStats.includes(bet.stat_type)) {
              xgbRequests.push({ player, statType: bet.stat_type, line: Number(bet.line) });
              betIndices.push(i);
            }
          }
        }

        apiLogger.info("XGBoost enrichment: " + xgbRequests.length + " requests from " + playerMap.size + " players");
        if (xgbRequests.length > 0) {
          const xgbResults = await batchXGBoostPredict(xgbRequests);
          for (let j = 0; j < xgbRequests.length; j++) {
            const req = xgbRequests[j];
            const idx = betIndices[j];
            const key = `${req.player.player_name}_${req.statType}_${req.line}`;
            const pred = xgbResults.get(key);
            if (pred) {
              (bets[idx] as any).xgb_prob_over = pred.prob_over;
              (bets[idx] as any).xgb_confidence = pred.confidence;
              (bets[idx] as any).xgb_model_type = pred.model_type;
              (bets[idx] as any).ml_explanation = {
                shap_drivers: (pred.shap_top_drivers || []).slice(0, 8),
                calibration: pred.calibration_method || "none",
                calibration_shift: pred.calibration_shift || 0,
                raw_prob_over: pred.raw_prob_over ?? null,
              };
            }
          }
        }
      } catch (xgbErr: any) {
        apiLogger.error("XGBoost enrichment error (non-fatal):", xgbErr?.message || xgbErr);
      }

      // Enrich bets with signal scores if not already present
      const enrichedBets = bets.map(bet => {
        // If bet already has signal_score, return as-is
        if ((bet as any).signal_score !== undefined && (bet as any).signal_score !== null) {
          return bet;
        }

        // Compute signal score based on edge type
        const edges: Array<{ type: string; score: number }> = [];
        if (bet.edge_type) {
          edges.push({ type: bet.edge_type, score: bet.edge_score || 5 });
        }

        const recommendation = bet.recommendation as 'OVER' | 'UNDER';
        const signalScore = calculateSignalScore(
          {} as any, // Player not needed for edge-based scoring
          bet.stat_type || '',
          recommendation,
          bet.hit_rate || 50,
          edges
        );

        return {
          ...bet,
          signal_score: signalScore.signalScore,
          signal_confidence: signalScore.signalConfidence,
          active_signals: signalScore.signals.length > 0 ? signalScore.signals : null,
          signal_description: getSignalDescription(signalScore),
        };
      });

      // Show all PrizePicks props with our analysis — sorted by quality
      // Sort by signal score first (backtest-backed), then edge score, then hit rate
      const sortedBets = enrichedBets.sort((a, b) => {
        // Priority 1: Signal score (backtest-proven signals)
        const aSignal = (a as any).signal_score || 0;
        const bSignal = (b as any).signal_score || 0;
        if (Math.abs(aSignal - bSignal) > 0.1) return bSignal - aSignal;

        // Priority 2: Signal confidence level
        if ((a as any).signal_confidence === "HIGH" && (b as any).signal_confidence !== "HIGH") return -1;
        if ((b as any).signal_confidence === "HIGH" && (a as any).signal_confidence !== "HIGH") return 1;

        // Priority 3: Edge score
        if (a.edge_score && !b.edge_score) return -1;
        if (!a.edge_score && b.edge_score) return 1;
        if (a.edge_score && b.edge_score) {
          if (a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
        }

        // Priority 4: Basic confidence
        if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
        if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;

        // For hit rate, sort by distance from 50% (more extreme = better)
        const aDeviation = Math.abs(a.hit_rate - 50);
        const bDeviation = Math.abs(b.hit_rate - 50);
        return bDeviation - aDeviation;
      });

      // Return all bets (sorted best-first) — frontend groups by game
      const limitedBets = sortedBets.slice(0, 200);

      res.json(limitedBets);
    } catch (error) {
      apiLogger.error("Error fetching bets:", error);
      res.status(500).json({ error: "Failed to fetch bets" });
    }
  });

  // Get top 10 best picks - uses projection model data for highest probability picks
  app.get("/api/bets/top-picks", async (req, res) => {
    try {
      if (!pool) return res.json([]);
      const result = await pool.query(`
        WITH ranked_picks AS (
          SELECT DISTINCT ON (pdl.player_name, po.prop_type)
            pdl.player_name,
            COALESCE(pdl.team, '') as team,
            po.prop_type as stat_type,
            COALESCE(pdl.closing_line, po.prizepicks_line) as line,
            CASE WHEN po.edge_pct > 0 THEN 'OVER' ELSE 'UNDER' END as recommendation,
            CASE
              WHEN ABS(po.edge_pct) >= 8 THEN 'HIGH'
              WHEN ABS(po.edge_pct) >= 4 THEN 'MEDIUM'
              ELSE 'LOW'
            END as confidence,
            'PROJECTION' as edge_type,
            ROUND(ABS(po.edge_pct)::numeric, 2) as edge_score,
            'Model projects ' || ROUND(po.final_projection::numeric, 1) || ' vs line ' || COALESCE(pdl.closing_line, po.prizepicks_line) || ' (' || ROUND(ABS(po.edge_pct)::numeric, 1) || '% edge)' as edge_description,
            ROUND(po.final_projection::numeric, 2) as season_avg,
            ROUND(po.final_projection::numeric, 2) as last_5_avg,
            LEAST(50 + ABS(po.edge_pct) * 4, 95)::numeric as hit_rate,
            LEAST(50 + ABS(po.edge_pct) * 4, 95)::numeric as adjusted_hit_rate,
            ROUND((ABS(po.edge_pct) / 100 * 2)::numeric, 4) as expected_value,
            ROUND((ABS(po.edge_pct) / 100)::numeric, 4) as kelly_size,
            10 as sample_size,
            ABS(po.edge_pct) as abs_edge
          FROM projection_outputs po
          INNER JOIN prizepicks_daily_lines pdl
            ON po.player_id::text = pdl.prizepicks_player_id::text
            AND po.prop_type = pdl.stat_type
            AND ((pdl.game_time AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York')::date = (NOW() AT TIME ZONE 'America/New_York')::date
          WHERE po.game_date = (NOW() AT TIME ZONE 'America/New_York')::date
            AND po.confidence_tier != 'SKIP'
            AND po.prizepicks_line IS NOT NULL AND po.prizepicks_line > 0.5
          ORDER BY pdl.player_name, po.prop_type, ABS(po.edge_pct) DESC
        )
        SELECT player_name, team, stat_type, line, recommendation, confidence,
               edge_type, edge_score, edge_description, season_avg, last_5_avg,
               hit_rate, adjusted_hit_rate, expected_value, kelly_size, sample_size
        FROM ranked_picks
        ORDER BY abs_edge DESC
        LIMIT 10
      `);
      res.json(result.rows);
    } catch (error) {
      apiLogger.error("Error fetching top picks:", error);
      res.status(500).json({ error: "Failed to fetch top picks" });
    }
  });

  // NOTE: Duplicate /api/bets/refresh route removed - using PrizePicks version above

}
