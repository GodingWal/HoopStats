/**
 * XGBoost Feature Logger Service
 *
 * Logs predictions with feature vectors at bet generation time,
 * and fills in outcomes at settlement time.
 *
 * This is the TypeScript-side bridge to the xgboost_training_log table.
 * The Python-side OutcomeLogger reads from the same table for model training.
 *
 * Integration points:
 *   - Bet generation (bets-routes.ts): logPrediction() after each bet is created
 *   - Auto-settle (auto-settle.ts): logOutcome() when picks are settled
 */

import { eq, and, isNull } from "drizzle-orm";
import { xgboostTrainingLog } from "@shared/schema";
import type { Player } from "@shared/schema";
import { serverLogger } from "../logger";
import { pool } from "../db";

/**
 * Build the XGBoost feature vector from available player data and bet context.
 *
 * Mirrors the 46 features from the Python XGBoostFeatureBuilder,
 * extracting what's available from the TypeScript Player object.
 */
function buildFeatures(
  player: Player,
  statType: string,
  line: number,
  edgeScores: Record<string, number>,
  extra: {
    hitRate?: number;
    recommendation?: string;
    confidence?: string;
    expectedValue?: number;
  } = {},
): Record<string, number> {
  const features: Record<string, number> = {};

  // --- Group 1: Edge scores ---
  features.edge_star_out = edgeScores.star_out ?? edgeScores.STAR_OUT ?? 0;
  features.edge_b2b = edgeScores.back_to_back ?? edgeScores.BACK_TO_BACK ?? 0;
  features.edge_blowout = edgeScores.blowout_risk ?? edgeScores.BLOWOUT_RISK ?? 0;
  features.edge_pace = edgeScores.pace_matchup ?? edgeScores.PACE_MATCHUP ?? 0;
  features.edge_bad_defense = edgeScores.bad_defense ?? edgeScores.BAD_DEFENSE ?? 0;
  features.edge_minutes_stability = edgeScores.minutes_stability ?? edgeScores.MINUTES_STABILITY ?? 0;
  features.edge_recent_form = edgeScores.recent_form ?? edgeScores.RECENT_FORM ?? 0;
  features.edge_home_road = edgeScores.home_road_split ?? edgeScores.HOME_ROAD_SPLIT ?? 0;
  features.edge_line_movement = edgeScores.line_movement ?? edgeScores.LINE_MOVEMENT ?? 0;

  const edgeValues = [
    features.edge_star_out, features.edge_b2b, features.edge_blowout,
    features.edge_pace, features.edge_bad_defense, features.edge_minutes_stability,
    features.edge_recent_form, features.edge_home_road, features.edge_line_movement,
  ];
  features.total_edges_fired = edgeValues.filter(v => v > 0).length;

  // --- Group 2: Raw numeric inputs ---
  const seasonAvg = getStatValue(player.season_averages, statType);
  const l5Avg = getStatValue(player.last_5_averages, statType);
  const l10Avg = getStatValue(player.last_10_averages, statType);

  features.line_vs_avg_l10 = l10Avg > 0 ? (line - l10Avg) / l10Avg : 0;
  features.line_vs_avg_l5 = l5Avg > 0 ? (line - l5Avg) / l5Avg : 0;
  features.line_vs_season_avg = seasonAvg > 0 ? (line - seasonAvg) / seasonAvg : 0;

  features.team_pace_actual = player.team_pace ?? 100;
  features.opp_pace_actual = 100; // Will be enriched when opponent data available
  features.pace_differential = features.team_pace_actual - features.opp_pace_actual;

  features.opp_def_rating = 110; // Default — enriched from opponent context
  features.opp_pts_allowed_to_pos = 0;

  // Player vs opponent historical average
  const oppKey = player.next_opponent ?? "";
  const vsTeamData = oppKey && player.vs_team?.[oppKey];
  if (vsTeamData) {
    features.player_vs_opp_hist_avg = getStatValue(vsTeamData, statType);
  } else {
    features.player_vs_opp_hist_avg = 0;
  }

  // Minutes from game logs
  const gameLogs = player.game_logs ?? player.recent_games ?? [];
  const minutesL10 = gameLogs.slice(0, 10).map(g => g.MIN).filter((m): m is number => typeof m === "number" && m > 0);
  const minutesL5 = minutesL10.slice(0, 5);

  features.minutes_avg_l10 = minutesL10.length > 0 ? avg(minutesL10) : 30;
  features.minutes_avg_l5 = minutesL5.length > 0 ? avg(minutesL5) : features.minutes_avg_l10;
  features.minutes_floor_l10 = minutesL10.length > 0 ? Math.min(...minutesL10) : features.minutes_avg_l10 - 5;
  features.minutes_stdev_l10 = minutesL10.length > 1 ? stdev(minutesL10) : 3;

  // Home/away split
  const homeAvg = getStatValue(player.home_averages, statType);
  const awayAvg = getStatValue(player.away_averages, statType);
  features.home_away_diff = homeAvg - awayAvg;
  const combined = (homeAvg + awayAvg) / 2;
  features.home_away_diff_pct = combined > 0 ? features.home_away_diff / combined : 0;
  features.is_home = player.next_game_location === "home" ? 1 : 0;

  // Situational — detect B2B from game logs
  features.days_rest = detectDaysRest(gameLogs);
  features.is_b2b = features.days_rest <= 1 ? 1 : 0;
  features.game_total_ou = 225; // Default — enriched from odds context
  features.abs_spread = 0; // Default — enriched from odds context

  // Usage
  features.usage_rate_season = player.usage_rate ?? 20;
  features.usage_rate_l5 = features.usage_rate_season; // Would need L5 usage data
  features.usage_delta = 0;

  // Historical hit rate
  features.hist_hit_rate = (extra.hitRate ?? 50) / 100;

  // --- Group 3: Volatility ---
  const statValues = extractStatValues(gameLogs, statType, 10);
  if (statValues.length >= 3) {
    const mean = avg(statValues);
    const sd = stdev(statValues);
    features.stdev_last_10 = sd;
    features.coeff_of_variation = mean > 0 ? sd / mean : 0;
    features.pct_games_over_line = line > 0 ? statValues.filter(v => v > line).length / statValues.length : 0.5;

    // IQR
    const sorted = [...statValues].sort((a, b) => a - b);
    const q25 = percentile(sorted, 25);
    const q75 = percentile(sorted, 75);
    features.iqr_last_10 = q75 - q25;
  } else {
    features.stdev_last_10 = 0;
    features.coeff_of_variation = 0.3;
    features.pct_games_over_line = 0.5;
    features.iqr_last_10 = 0;
  }

  // --- Group 4: Line movement ---
  features.line_move_direction = 0;
  features.line_move_magnitude = 0;

  // --- Group 5: CLV ---
  features.closing_line_value = 0;
  features.clv_l10 = 0;

  // --- Group 6: Meta ---
  features.signal_score = 0;
  features.signal_count = features.total_edges_fired;
  features.projected_value = seasonAvg; // Best estimate without full projection
  features.projected_minutes = features.minutes_avg_l10;

  return features;
}

// ---- Helpers ----

function getStatValue(obj: Record<string, unknown> | null | undefined, statType: string): number {
  if (!obj) return 0;
  // Try stat type directly, then common aliases
  const keys = [statType, statType.toUpperCase()];
  if (statType === "PTS") keys.push("pts", "Points");
  if (statType === "REB") keys.push("reb", "Rebounds");
  if (statType === "AST") keys.push("ast", "Assists");
  if (statType === "FG3M") keys.push("fg3m", "3-Pointers Made", "3PM");
  if (statType === "PRA") keys.push("pra", "Pts+Rebs+Asts");

  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "number") return val;
  }
  return 0;
}

function extractStatValues(gameLogs: Array<Record<string, unknown>>, statType: string, n: number): number[] {
  const colMap: Record<string, string[]> = {
    PTS: ["PTS", "pts"], REB: ["REB", "reb"], AST: ["AST", "ast"],
    FG3M: ["FG3M", "fg3m", "3PM"], STL: ["STL", "stl"], BLK: ["BLK", "blk"],
    PRA: ["PRA"],
  };
  const keys = colMap[statType] ?? [statType];
  const values: number[] = [];

  for (const g of gameLogs.slice(0, n)) {
    // For PRA, compute from components
    if (statType === "PRA") {
      const pts = Number(g.PTS ?? g.pts ?? 0);
      const reb = Number(g.REB ?? g.reb ?? 0);
      const ast = Number(g.AST ?? g.ast ?? 0);
      if (pts || reb || ast) values.push(pts + reb + ast);
      continue;
    }
    for (const key of keys) {
      const val = g[key];
      if (val !== undefined && val !== null) {
        values.push(Number(val));
        break;
      }
    }
  }
  return values;
}

function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function stdev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = avg(nums);
  const variance = nums.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function detectDaysRest(gameLogs: Array<Record<string, unknown>>): number {
  if (!gameLogs || gameLogs.length < 2) return 2;
  const d0 = gameLogs[0]?.GAME_DATE;
  const d1 = gameLogs[1]?.GAME_DATE;
  if (!d0 || !d1) return 2;
  try {
    const diff = (new Date(String(d0)).getTime() - new Date(String(d1)).getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, Math.round(diff));
  } catch {
    return 2;
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Log a prediction (at bet generation time) to the xgboost_training_log table.
 *
 * Non-blocking — errors are logged but never thrown to caller.
 */
export async function logXGBoostPrediction(
  player: Player,
  statType: string,
  line: number,
  recommendation: string,
  confidence: string,
  edges: Array<{ type: string; score: number }>,
  extra: {
    hitRate?: number;
    expectedValue?: number;
    edgeTotalScore?: number;
  } = {},
): Promise<void> {
  if (!pool) return; // No database

  try {
    // Build edge scores map from edge array
    const edgeScores: Record<string, number> = {};
    for (const edge of edges) {
      edgeScores[edge.type] = edge.score;
    }

    const features = buildFeatures(player, statType, line, edgeScores, {
      hitRate: extra.hitRate,
      recommendation,
      confidence,
      expectedValue: extra.expectedValue,
    });

    const today = new Date().toISOString().split("T")[0];

    await pool.query(
      `INSERT INTO xgboost_training_log (
        player_id, game_date, stat_type, line_value,
        features, signal_score, edge_total,
        predicted_direction, confidence_tier,
        captured_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (player_id, game_date, stat_type)
      DO UPDATE SET
        line_value = EXCLUDED.line_value,
        features = EXCLUDED.features,
        signal_score = EXCLUDED.signal_score,
        edge_total = EXCLUDED.edge_total,
        predicted_direction = EXCLUDED.predicted_direction,
        confidence_tier = EXCLUDED.confidence_tier,
        captured_at = NOW()`,
      [
        String(player.player_id),
        today,
        statType,
        line,
        JSON.stringify(features),
        features.signal_score,
        extra.edgeTotalScore ?? 0,
        recommendation,
        confidence,
      ],
    );
  } catch (err) {
    serverLogger.warn(`XGBoost log prediction failed: ${err}`);
  }
}

/**
 * Log an outcome (at settlement time) for a previously logged prediction.
 *
 * Matches on player name (normalized) + game date + stat type.
 * Non-blocking — errors are logged but never thrown.
 */
export async function logXGBoostOutcome(
  playerName: string,
  gameDate: string,
  statType: string,
  actualValue: number,
  actualMinutes?: number,
): Promise<void> {
  if (!pool) return;

  try {
    // Normalize date to YYYY-MM-DD
    const normalizedDate = gameDate.replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");

    // We match on stat_type (need to map from ESPN stat labels to our abbrevs)
    const statMap: Record<string, string[]> = {
      PTS: ["PTS", "Points"], REB: ["REB", "Rebounds"], AST: ["AST", "Assists"],
      FG3M: ["FG3M", "3-Pointers Made", "3PM"], PRA: ["PRA", "Pts+Rebs+Asts"],
      STL: ["STL", "Steals"], BLK: ["BLK", "Blocks"],
    };
    const possibleTypes = statMap[statType.toUpperCase()] ?? [statType];

    for (const st of possibleTypes) {
      const result = await pool.query(
        `UPDATE xgboost_training_log
         SET actual_value = $1,
             actual_minutes = $2,
             hit = (actual_value IS NOT NULL AND $1 > line_value),
             settled_at = NOW()
         WHERE game_date = $3
           AND stat_type = $4
           AND actual_value IS NULL
         RETURNING id, line_value`,
        [actualValue, actualMinutes ?? null, normalizedDate, st],
      );

      if (result.rowCount && result.rowCount > 0) {
        // Fix hit calculation using actual line_value
        for (const row of result.rows) {
          const hit = actualValue > row.line_value;
          await pool.query(
            `UPDATE xgboost_training_log SET hit = $1 WHERE id = $2`,
            [hit, row.id],
          );
        }
        return;
      }
    }
  } catch (err) {
    serverLogger.warn(`XGBoost log outcome failed: ${err}`);
  }
}

/**
 * Batch log outcomes for all settled picks in a game.
 * Called from auto-settle after player stats are extracted.
 */
export async function logXGBoostOutcomeBatch(
  settlements: Array<{
    playerName: string;
    gameDate: string;
    stat: string;
    actualValue: number;
    actualMinutes?: number;
  }>,
): Promise<number> {
  let logged = 0;
  for (const s of settlements) {
    await logXGBoostOutcome(s.playerName, s.gameDate, s.stat, s.actualValue, s.actualMinutes);
    logged++;
  }
  return logged;
}

/**
 * Get training data stats for monitoring.
 */
export async function getXGBoostTrainingStats(): Promise<{
  total: number;
  labeled: number;
  unlabeled: number;
  hitRate: number | null;
}> {
  if (!pool) return { total: 0, labeled: 0, unlabeled: 0, hitRate: null };

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(actual_value) as labeled,
        COUNT(*) - COUNT(actual_value) as unlabeled,
        CASE WHEN COUNT(actual_value) > 0
          THEN ROUND(AVG(CASE WHEN hit THEN 1.0 ELSE 0.0 END)::numeric, 3)
          ELSE NULL END as hit_rate
      FROM xgboost_training_log
    `);
    const row = result.rows[0];
    return {
      total: Number(row.total),
      labeled: Number(row.labeled),
      unlabeled: Number(row.unlabeled),
      hitRate: row.hit_rate ? Number(row.hit_rate) : null,
    };
  } catch (err) {
    serverLogger.warn(`XGBoost stats query failed: ${err}`);
    return { total: 0, labeled: 0, unlabeled: 0, hitRate: null };
  }
}
