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
import type { Player } from "@shared/schema";

const MODEL_DIR = path.join(
  __dirname,
  "nba-prop-model",
  "models",
  "xgboost"
);

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

export interface XGBoostPrediction {
  prob_over: number;
  prob_under: number;
  confidence: number;
  predicted_hit: boolean;
  model_type: string;
  top_features: Array<[string, number]>;
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
    days_rest: 1,
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

  for (const { player, statType, line } of requests) {
    const modelName = STAT_TYPE_MAP[statType];
    if (!modelName) continue;

    const modelPath = path.join(MODEL_DIR, `${modelName}.json`);
    if (!fs.existsSync(modelPath)) continue;

    const statKey = STAT_KEY_MAP[modelName] || "pts";
    const key = `${player.player_name}_${statType}_${line}`;

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
        days_rest: 1,
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
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath("${MODEL_DIR}")), '..'))
os.chdir(os.path.join("${path.join(__dirname, "nba-prop-model")}"))

from src.models.xgboost_model import XGBoostPropModel
model = XGBoostPropModel(model_dir="${MODEL_DIR}")
model.load("${modelName}")
context = json.loads(sys.stdin.read())
pred = model.predict(context, "${modelName}")
importances = sorted(pred.feature_importances.items(), key=lambda x: x[1], reverse=True)[:5]
print(json.dumps({
    "prob_over": pred.prob_over,
    "prob_under": pred.prob_under,
    "confidence": pred.confidence,
    "predicted_hit": pred.predicted_hit,
    "model_type": pred.model_type,
    "top_features": importances
}))
`;

    const pythonCmd =
      process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", script], {
      cwd: path.join(__dirname, "nba-prop-model"),
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
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath("${MODEL_DIR}")), '..'))
os.chdir("${path.join(__dirname, "nba-prop-model")}")

from src.models.xgboost_model import XGBoostPropModel
model = XGBoostPropModel(model_dir="${MODEL_DIR}")

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
        results[key] = {
            "prob_over": pred.prob_over,
            "prob_under": pred.prob_under,
            "confidence": pred.confidence,
            "predicted_hit": pred.predicted_hit,
            "model_type": pred.model_type,
            "top_features": importances
        }
    except Exception as e:
        pass

print(json.dumps(results))
`;

    const pythonCmd =
      process.platform === "win32" ? "python" : "python3";
    const proc = spawn(pythonCmd, ["-c", script], {
      cwd: path.join(__dirname, "nba-prop-model"),
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
