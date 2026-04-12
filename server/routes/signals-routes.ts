import type { Express } from "express";
import { pool } from "../db";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { BETTING_CONFIG } from "../constants";
import type { Player } from "@shared/schema";
import { analyzeEdges } from "../edge-detection";
import { loadSignalWeights, calculateSignalScore, hasStrongSignalSupport, getSignalDescription } from "../signal-scoring";
import { ensurePlayersLoaded, parseHitRateEntry, getCached, setCached, runPythonScript, getPythonCommand } from "./route-helpers";

export function registerSignalsRoutes(app: Express): void {
  app.get("/api/signals/history", async (req, res) => {
    try {
      const days = parseInt((req.query.days as string) || "30", 10);
      const cacheKey = `signals_history_${days}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `SELECT
           signal_type,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome = true) AS wins,
           ROUND(COUNT(*) FILTER (WHERE outcome = true)::numeric / NULLIF(COUNT(*), 0), 4) AS hit_rate,
           ROUND(AVG(clv), 2) AS avg_clv,
           ROUND(AVG(edge_pct), 2) AS avg_edge
         FROM signal_results
         WHERE game_date >= NOW() - $1 * INTERVAL '1 day'
           AND outcome IS NOT NULL
         GROUP BY signal_type
         ORDER BY hit_rate DESC`,
        [days]
      );

      const data = { signals: result.rows, days };
      setCached(cacheKey, data);
      res.json({ ...data, cached: false });
    } catch (error: any) {
      apiLogger.error("[Signal History] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/signals/weights — Current weight_registry values
  app.get("/api/signals/weights", async (req, res) => {
    try {
      const cacheKey = "signals_weights";
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ weights: cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const result = await pool.query(
        `SELECT signal_type, weight, hit_rate, clv_rate, sample_size, updated_at
         FROM weight_registry
         ORDER BY weight DESC`
      );

      setCached(cacheKey, result.rows);
      res.json({ weights: result.rows, cached: false });
    } catch (error: any) {
      apiLogger.error("[Signal Weights] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/signals/run — Manually trigger signal engine for a player/game
  app.post("/api/signals/run", async (req, res) => {
    try {
      const {
        player_id,
        team_id,
        opp_team_id,
        game_date,
        prop_type,
        prizepicks_line,
        absent_players = [],
        referee_crew = [],
        extra = {},
      } = req.body;

      if (!player_id || !prop_type || !prizepicks_line) {
        return res.status(400).json({
          error: "Required: player_id, prop_type, prizepicks_line",
        });
      }

      const targetDate = game_date || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

      // Spawn Python to run signal engine
      const contextArg = JSON.stringify({
        player_id,
        team_id: team_id || "",
        opp_team_id: opp_team_id || "",
        game_date: targetDate,
        prop_type,
        prizepicks_line,
        absent_players,
        referee_crew,
        ...extra,
      });

      const pyScript = `
import sys, json, os
sys.path.insert(0, "/var/www/courtsideedge/server/nba-prop-model")
os.chdir("/var/www/courtsideedge/server/nba-prop-model")
from src.signals.signal_engine import SignalEngine, GameContext
ctx_data = json.loads(${JSON.stringify(JSON.stringify(contextArg))})
if isinstance(ctx_data, str): ctx_data = json.loads(ctx_data)
ctx = GameContext(
    player_id=ctx_data.get('player_id',''),
    team_id=ctx_data.get('team_id',''),
    opp_team_id=ctx_data.get('opp_team_id',''),
    game_date=ctx_data.get('game_date',''),
    prop_type=ctx_data.get('prop_type',''),
    prizepicks_line=float(ctx_data.get('prizepicks_line',0)),
    absent_players=ctx_data.get('absent_players',[]),
    referee_crew=ctx_data.get('referee_crew',[]),
    extra={k:v for k,v in ctx_data.items() if k not in ('player_id','team_id','opp_team_id','game_date','prop_type','prizepicks_line','absent_players','referee_crew')},
)
engine = SignalEngine()
result = engine.run(ctx)
print(json.dumps(result.to_dict()))
`;

      const pythonCmd = getPythonCommand();
      const { execSync } = require("child_process");
      try {
        const output = execSync(`${pythonCmd} -c "${pyScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
          cwd: "/var/www/courtsideedge/server/nba-prop-model",
          env: { ...process.env },
          timeout: 15000,
        });
        res.json(JSON.parse(output.toString()));
      } catch (execErr: any) {
        // Fallback: return signal skeletons without running Python
        res.json({
          weighted_delta: 0,
          direction: null,
          confidence_tier: "SKIP",
          signals_fired: [],
          signals_skipped: [],
          conflict_detected: false,
          error: "Signal engine unavailable",
        });
      }
    } catch (error: any) {
      apiLogger.error("[Signals Run] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/clv/summary — CLV stats by confidence tier
  app.get("/api/clv/summary", async (req, res) => {
    try {
      const cacheKey = "clv_summary";
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
      }

      if (!pool) {
        return res.status(503).json({ error: "Database not available" });
      }

      const [overall, byTier] = await Promise.all([
        pool.query(
          `SELECT
             COUNT(*) AS total_plays,
             ROUND(AVG(clv), 2) AS avg_clv,
             COUNT(*) FILTER (WHERE clv > 0)::numeric / NULLIF(COUNT(*), 0) AS pct_positive_clv
           FROM signal_results
           WHERE clv IS NOT NULL`
        ),
        pool.query(
          `SELECT
             po.confidence_tier,
             COUNT(*) AS plays,
             ROUND(AVG(sr.clv), 2) AS avg_clv,
             ROUND(COUNT(*) FILTER (WHERE sr.outcome = true)::numeric / NULLIF(COUNT(*), 0), 4) AS hit_rate
           FROM projection_outputs po
           LEFT JOIN signal_results sr ON sr.player_id = po.player_id
             AND sr.game_date = po.game_date
             AND sr.prop_type = po.prop_type
           WHERE po.confidence_tier IS NOT NULL
           GROUP BY po.confidence_tier
           ORDER BY po.confidence_tier`
        ),
      ]);

      const data = {
        overall: overall.rows[0],
        by_tier: byTier.rows,
      };
      setCached(cacheKey, data);
      res.json({ ...data, cached: false });
    } catch (error: any) {
      apiLogger.error("[CLV Summary] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/backtest?signal=usage&days=90 — Backtest results for specific signal
}
