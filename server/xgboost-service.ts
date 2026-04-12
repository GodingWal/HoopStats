/**
 * XGBoost Inference Service
 *
 * Calls the trained Python XGBoost models to get probability predictions
 * for player props. Blends XGBoost output with existing analytical edge
 * scores to produce better recommendations.
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import type { Player } from "@shared/schema";
import { pool } from "./db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hardcoded paths - avoids esbuild __dirname resolving to dist/
const NBA_PROP_DIR = "/var/www/courtsideedge/server/nba-prop-model";
const MODEL_DIR = "/var/www/courtsideedge/server/nba-prop-model/models/xgboost";
const VENV_PYTHON = "/var/www/courtsideedge/server/nba-prop-model/venv/bin/python";

// Map frontend stat types to XGBoost model names
const STAT_TYPE_MAP: Record<string, string> = {
  PTS: "Points",
  REB: "Rebounds",
  AST: "Assists",
  FG3M: "3-Pointers Made",
  STL: "Steals",
  BLK: "Blocks",
  TOV: "Turnovers",
};

// Reverse map for feature building
const STAT_KEY_MAP: Record<string, string> = {
  Points: "pts",
  Rebounds: "reb",
  Assists: "ast",
  "3-Pointers Made": "fg3m",
  Steals: "stl",
  Blocks: "blk",
  Turnovers: "tov",
};

// Mapping from normalized position to team_stats defensive column
const POSITION_DEF_COL: Record<string, string> = {
  PG: "def_vs_pg",
  SG: "def_vs_sg",
  SF: "def_vs_sf",
  PF: "def_vs_pf",
  C:  "def_vs_c",
};

// Normalize a raw position string (e.g. "PG-SG", "Forward", "C") to one key
function normalizePosition(pos: string | undefined): string | null {
  if (!pos) return null;
  const p = pos.toUpperCase();
  if (p.startsWith("PG") || p === "G") return "PG";
  if (p.startsWith("SG")) return "SG";
  if (p.startsWith("PF")) return "PF";
  if (p.startsWith("SF") || p === "F") return "SF";
  if (p.startsWith("C")) return "C";
  return null;
}

interface OppDefenseStats {
  opp_defensive_rating: number | null;
  opp_pace: number | null;
  opp_pts_allowed_to_position: number | null;
}

/**
 * Query team_stats for the opponent's defensive rating, pace, and
 * position-specific points allowed.  Returns nulls on any failure so
 * the XGBoost pipeline always stays non-blocking.
 *
 * These features are captured in the training context so the model can
 * learn from them on next retrain.  The current model truncates unknown
 * features and is unaffected until retrained.
 */
async function getOpponentDefenseStats(
  oppTeam: string | undefined,
  position: string | undefined,
): Promise<OppDefenseStats> {
  const empty: OppDefenseStats = {
    opp_defensive_rating: null,
    opp_pace: null,
    opp_pts_allowed_to_position: null,
  };
  if (!oppTeam || !pool) return empty;

  try {
    const season = "2024-25";
    const normPos = normalizePosition(position);
    const defCol = normPos ? POSITION_DEF_COL[normPos] : null;

    const selectCols = defCol
      ? `def_rating, pace, ${defCol} AS pos_def`
      : `def_rating, pace`;
    const rows = await pool.query(
      `SELECT ${selectCols} FROM team_stats WHERE team_id = $1 AND season = $2 LIMIT 1`,
      [oppTeam, season],
    );
    if (rows.rows.length === 0) return empty;
    const row = rows.rows[0];
    return {
      opp_defensive_rating: row.def_rating != null ? parseFloat(row.def_rating) : null,
      opp_pace: row.pace != null ? parseFloat(row.pace) : null,
      opp_pts_allowed_to_position: row.pos_def != null ? parseFloat(row.pos_def) : null,
    };
  } catch {
    // Non-fatal — XGBoost works without this data
    return empty;
  }
}

/**
 * Preload opponent defense stats for a batch of requests.
 * Single query for all unique opponent teams avoids N+1 DB calls.
 */
async function preloadOpponentDefense(
  requests: Array<{ team: string | undefined; position: string | undefined }>,
): Promise<Map<string, OppDefenseStats>> {
  const cache = new Map<string, OppDefenseStats>();
  if (!pool) return cache;

  const uniqueTeams = [...new Set(requests.map((r) => r.team).filter(Boolean))] as string[];
  if (uniqueTeams.length === 0) return cache;

  try {
    const season = "2024-25";
    const rows = await pool.query(
      `SELECT team_id, def_rating, pace, def_vs_pg, def_vs_sg, def_vs_sf, def_vs_pf, def_vs_c
       FROM team_stats WHERE team_id = ANY($1) AND season = $2`,
      [uniqueTeams, season],
    );
    for (const row of rows.rows) {
      cache.set(row.team_id, {
        opp_defensive_rating: row.def_rating != null ? parseFloat(row.def_rating) : null,
        opp_pace: row.pace != null ? parseFloat(row.pace) : null,
        // position-specific column resolved per-request below
        opp_pts_allowed_to_position: null,
      });
      // Store raw positional columns so callers can pick the right one
      (cache.get(row.team_id) as any)._raw = row;
    }
  } catch {
    // Non-fatal
  }
  return cache;
}

function resolvePositionalDef(cached: OppDefenseStats, position: string | undefined): OppDefenseStats {
  const raw = (cached as any)._raw;
  if (!raw) return cached;
  const normPos = normalizePosition(position);
  const defCol = normPos ? POSITION_DEF_COL[normPos] : null;
  return {
    opp_defensive_rating: cached.opp_defensive_rating,
    opp_pace: cached.opp_pace,
    opp_pts_allowed_to_position: defCol && raw[defCol] != null ? parseFloat(raw[defCol]) : null,
  };
}

export interface ShapDriver {
  feature: string;
  shap_value: number;
  feature_value: number;
  direction: string; // "OVER" | "UNDER"
}

export interface XGBoostPrediction {
  prob_over: number;
  prob_under: number;
  confidence: number;
  predicted_hit: boolean;
  model_type: string;
  top_features: Array<[string, number]>;
  // Calibration metadata
  calibration_method: string; // "isotonic" | "none"
  raw_prob_over: number; // Pre-calibration probability
  calibration_shift: number; // calibrated - raw
  // SHAP explanation (top drivers for this specific prediction)
  shap_top_drivers: ShapDriver[];
  shap_base_value: number | null;
}

/**
 * Check which XGBoost models are available (trained and saved).
 */
export function getAvailableModels(): string[] {
  try {
    if (!fs.existsSync(MODEL_DIR)) return [];
    return fs
      .readdirSync(MODEL_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
}

/**
 * Get XGBoost prediction for a single player-prop.
 * Spawns Python process for inference.
 */
export async function getXGBoostPrediction(
  player: Player,
  statType: string,
  line: number
): Promise<XGBoostPrediction | null> {
  const modelName = STAT_TYPE_MAP[statType];
  if (!modelName) return null;

  const modelPath = path.join(MODEL_DIR, `${modelName}.json`);
  if (!fs.existsSync(modelPath)) return null;

  const statKey = STAT_KEY_MAP[modelName] || "pts";

  // Fetch opponent defensive context so it's captured in the training log.
  // The current model truncates unknown features; these become useful after retraining.
  const oppDef = await getOpponentDefenseStats(player.next_opponent, player.position);

  // Build context for XGBoost feature builder
  const context = {
    line,
    stat_type: modelName,
    player_name: player.player_name,
    team: player.team,
    season_averages: buildAvgDict(player.season_averages, statKey),
    last_5_averages: buildAvgDict(player.last_5_averages, statKey),
    last_10_averages: buildAvgDict(player.last_10_averages, statKey),
    home_averages: buildAvgDict(player.home_averages, statKey),
    away_averages: buildAvgDict(player.away_averages, statKey),
    game_logs: player.recent_games || [],
    usage_rate: player.usage_rate || 20,
    projected_minutes: player.season_averages?.MIN || 30,
    hit_rate: getHitRate(player, statType, line),
    is_home: player.next_game_location === "home",
    is_b2b: isBackToBack(player),
    days_rest: getDaysRest(player),
    // Opponent defense features — also forwarded as opp_def_rating for signal engine
    opp_defensive_rating: oppDef.opp_defensive_rating,
    opp_def_rating: oppDef.opp_defensive_rating,      // signal engine alias
    opp_pace: oppDef.opp_pace,
    opp_pts_allowed_to_position: oppDef.opp_pts_allowed_to_position,
  };

  return runPythonInference(modelName, context);
}

/**
 * Batch predict for multiple player-props at once (more efficient).
 */
export async function batchXGBoostPredict(
  requests: Array<{ player: Player; statType: string; line: number }>
): Promise<Map<string, XGBoostPrediction>> {
  const results = new Map<string, XGBoostPrediction>();
  const contexts: Array<{
    key: string;
    model_name: string;
    context: Record<string, unknown>;
  }> = [];

  // Preload all opponent defense stats in one DB query
  const oppDefCache = await preloadOpponentDefense(
    requests.map((r) => ({ team: r.player.next_opponent, position: r.player.position })),
  );

  for (const { player, statType, line } of requests) {
    const modelName = STAT_TYPE_MAP[statType];
    if (!modelName) continue;

    const modelPath = path.join(MODEL_DIR, `${modelName}.json`);
    if (!fs.existsSync(modelPath)) continue;

    const statKey = STAT_KEY_MAP[modelName] || "pts";
    const key = `${player.player_name}_${statType}_${line}`;

    const cachedDef = oppDefCache.get(player.next_opponent || "");
    const oppDef = cachedDef
      ? resolvePositionalDef(cachedDef, player.position)
      : { opp_defensive_rating: null, opp_pace: null, opp_pts_allowed_to_position: null };

    contexts.push({
      key,
      model_name: modelName,
      context: {
        line,
        stat_type: modelName,
        player_name: player.player_name,
        season_averages: buildAvgDict(player.season_averages, statKey),
        last_5_averages: buildAvgDict(player.last_5_averages, statKey),
        last_10_averages: buildAvgDict(player.last_10_averages, statKey),
        home_averages: buildAvgDict(player.home_averages, statKey),
        away_averages: buildAvgDict(player.away_averages, statKey),
        game_logs: player.recent_games || [],
        usage_rate: player.usage_rate || 20,
        projected_minutes: player.season_averages?.MIN || 30,
        hit_rate: getHitRate(player, statType, line),
        is_home: player.next_game_location === "home",
        is_b2b: isBackToBack(player),
        days_rest: getDaysRest(player),
        // Opponent defense features — captured in training log for next model retraining
        opp_defensive_rating: oppDef.opp_defensive_rating,
        opp_def_rating: oppDef.opp_defensive_rating,  // signal engine alias
        opp_pace: oppDef.opp_pace,
        opp_pts_allowed_to_position: oppDef.opp_pts_allowed_to_position,
      },
    });
  }

  if (contexts.length === 0) return results;

  try {
    const batchResults = await runPythonBatchInference(contexts);
    for (const [key, pred] of Object.entries(batchResults)) {
      results.set(key, pred as XGBoostPrediction);
    }
  } catch (err) {
    console.error("XGBoost batch inference failed:", err);
  }

  return results;
}

// ---------- Python process communication ----------

function runPythonInference(
  modelName: string,
  context: Record<string, unknown>
): Promise<XGBoostPrediction | null> {
  return new Promise((resolve) => {
    const script = `
import sys, json, os
import numpy as np
class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)): return int(obj)
        if isinstance(obj, (np.floating,)): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return super().default(obj)
sys.path.insert(0, "/var/www/courtsideedge/server")
os.chdir("/var/www/courtsideedge/server/nba-prop-model")

from src.models.xgboost_model import XGBoostPropModel
model = XGBoostPropModel(model_dir="/var/www/courtsideedge/server/nba-prop-model/models/xgboost")
model.load("${modelName}")
context = json.loads(sys.stdin.read())
pred = model.predict(context, "${modelName}")
importances = sorted(pred.feature_importances.items(), key=lambda x: x[1], reverse=True)[:5]

# Calibration: get raw (uncalibrated) probability for comparison
cal = model.calibrators.pop("${modelName}", None)
raw_uncal = model.predict_proba(context, "${modelName}")
if cal is not None:
    model.calibrators["${modelName}"] = cal
cal_method = "isotonic" if cal is not None else "none"
cal_shift = round(pred.prob_over - raw_uncal, 4)

# SHAP explanation
shap_data = []
shap_base = None
if pred.shap_explanation:
    shap_data = [
        {"feature": f, "shap_value": round(sv, 4), "feature_value": round(fv, 4),
         "direction": "OVER" if sv > 0 else "UNDER"}
        for f, sv, fv in pred.shap_explanation.top_drivers[:8]
    ]
    shap_base = float(pred.shap_explanation.base_value) if pred.shap_explanation.base_value is not None else None

print(json.dumps({
    "prob_over": pred.prob_over,
    "prob_under": pred.prob_under,
    "confidence": pred.confidence,
    "predicted_hit": pred.predicted_hit,
    "model_type": pred.model_type,
    "top_features": importances,
    "calibration_method": cal_method,
    "raw_prob_over": round(raw_uncal, 4),
    "calibration_shift": cal_shift,
    "shap_top_drivers": shap_data,
    "shap_base_value": shap_base
}, cls=NpEncoder))
`;

    const pythonCmd = VENV_PYTHON;
    const proc = spawn(pythonCmd, ["-c", script], {
      cwd: "/var/www/courtsideedge/server/nba-prop-model",
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(JSON.stringify(context));
    proc.stdin.end();

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    const timeout = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, 10000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        if (stderr) console.error("XGBoost inference error:", stderr);
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

function runPythonBatchInference(
  contexts: Array<{
    key: string;
    model_name: string;
    context: Record<string, unknown>;
  }>
): Promise<Record<string, XGBoostPrediction>> {
  return new Promise((resolve) => {
    const script = `
import sys, json, os
import numpy as np
class NpEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)): return int(obj)
        if isinstance(obj, (np.floating,)): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return super().default(obj)
sys.path.insert(0, "/var/www/courtsideedge/server")
os.chdir("/var/www/courtsideedge/server/nba-prop-model")

from src.models.xgboost_model import XGBoostPropModel
model = XGBoostPropModel(model_dir="/var/www/courtsideedge/server/nba-prop-model/models/xgboost")

# Load all available models
for stat in ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Steals', 'Blocks', 'Turnovers']:
    model.load(stat)

batch = json.loads(sys.stdin.read())
results = {}
for item in batch:
    key = item['key']
    model_name = item['model_name']
    context = item['context']
    try:
        pred = model.predict(context, model_name)
        importances = sorted(pred.feature_importances.items(), key=lambda x: x[1], reverse=True)[:5]

        # Calibration: get raw (uncalibrated) probability
        cal = model.calibrators.pop(model_name, None)
        raw_uncal = model.predict_proba(context, model_name)
        if cal is not None:
            model.calibrators[model_name] = cal
        cal_method = "isotonic" if cal is not None else "none"
        cal_shift = round(pred.prob_over - raw_uncal, 4)

        # SHAP explanation
        shap_data = []
        shap_base = None
        if pred.shap_explanation:
            shap_data = [
                {"feature": f, "shap_value": round(sv, 4), "feature_value": round(fv, 4),
                 "direction": "OVER" if sv > 0 else "UNDER"}
                for f, sv, fv in pred.shap_explanation.top_drivers[:8]
            ]
            shap_base = float(pred.shap_explanation.base_value) if pred.shap_explanation.base_value is not None else None

        results[key] = {
            "prob_over": pred.prob_over,
            "prob_under": pred.prob_under,
            "confidence": pred.confidence,
            "predicted_hit": pred.predicted_hit,
            "model_type": pred.model_type,
            "top_features": importances,
            "calibration_method": cal_method,
            "raw_prob_over": round(raw_uncal, 4),
            "calibration_shift": cal_shift,
            "shap_top_drivers": shap_data,
            "shap_base_value": shap_base
        }
    except Exception as e:
        pass

print(json.dumps(results, cls=NpEncoder))
`;

    const pythonCmd = VENV_PYTHON;
    const proc = spawn(pythonCmd, ["-c", script], {
      cwd: "/var/www/courtsideedge/server/nba-prop-model",
    });

    let stdout = "";
    let stderr = "";

    proc.stdin.write(JSON.stringify(contexts));
    proc.stdin.end();

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({});
    }, 30000);

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !stdout.trim()) {
        if (stderr) console.error("XGBoost batch error:", stderr);
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({});
      }
    });
  });
}

// ---------- Helper functions ----------

function buildAvgDict(
  avgObj: Record<string, unknown> | null | undefined,
  statKey: string
): Record<string, number> {
  if (!avgObj) return {};
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(avgObj)) {
    if (typeof val === "number") {
      result[key.toLowerCase()] = val;
    }
  }
  return result;
}

function getHitRate(player: Player, statType: string, line: number): number {
  const hitRates = player.hit_rates?.[statType];
  if (!hitRates) return 0.5;

  // Find closest line
  const lineStr = line.toString();
  const entry = hitRates[lineStr];
  if (entry) {
    if (typeof entry === "number") return entry / 100;
    return (entry as { rate: number }).rate / 100;
  }

  return 0.5;
}

function isBackToBack(player: Player): boolean {
  const games = player.recent_games;
  if (!games || games.length < 2) return false;

  try {
    const last = new Date(games[0]?.GAME_DATE || "");
    const prev = new Date(games[1]?.GAME_DATE || "");
    const diff = (last.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    return diff <= 2;
  } catch {
    return false;
  }
}

/**
 * Calculate actual rest days since the player's most recent game.
 * Returns days between last game date and today (capped at 7 to avoid outliers).
 */
function getDaysRest(player: Player): number {
  const games = player.recent_games;
  if (!games || games.length === 0) return 2; // default assumption

  try {
    const lastGameDate = new Date(games[0]?.GAME_DATE || "");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round(
      (today.getTime() - lastGameDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    // Clamp to [0, 7] — beyond 7 days rest is effectively the same
    return Math.max(0, Math.min(diff, 7));
  } catch {
    return 2;
  }
}
