/**
 * Shared route helper functions extracted from routes.ts
 */
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { storage } from "../storage";
import { pool } from "../db";
import type { Player, HitRateEntry } from "@shared/schema";
import { BETTING_CONFIG } from "../constants";
import { adjustedHitRate } from "../utils/statistics";
import { evaluateBetValue } from "../utils/ev-calculator";
import { apiLogger } from "../logger";
import { fetchAndBuildAllPlayers } from "../nba-api";
import { analyzeEdges } from "../edge-detection";
import { loadSignalWeights, calculateSignalScore, hasStrongSignalSupport, getSignalDescription } from "../signal-scoring";
import { calibrateBet } from "../confidence-calibration";
import { fetchPrizePicksProjections } from "../prizepicks-api";
import { batchXGBoostPredict, type XGBoostPrediction } from "../xgboost-service";

export function parseHitRateEntry(entry: HitRateEntry): { rate: number; sampleSize: number } {
  if (typeof entry === "number") return { rate: entry, sampleSize: 0 };
  return { rate: entry.rate, sampleSize: entry.sampleSize };
}

export async function ensurePlayersLoaded(): Promise<Player[]> {
  let players = await storage.getPlayers();
  if (players.length === 0) {
    apiLogger.info("No players in storage, fetching from ESPN...");
    const builtPlayers = await fetchAndBuildAllPlayers();
    if (builtPlayers.length > 0) {
      await storage.syncPlayers(builtPlayers);
      players = await storage.getPlayers();
    }
  }
  return players;
}

// Get the Python command - use venv on Linux (production), system python on Windows (dev)
export function getPythonCommand(): string {
  if (process.platform === 'win32') {
    return 'python';
  }
  // On Linux, use the venv Python if it exists, otherwise fall back to system python3
  const venvPath = path.join(process.cwd(), 'server', 'nba-prop-model', 'venv', 'bin', 'python');
  return fs.existsSync(venvPath) ? venvPath : 'python3';
}

// ========================================
// PROBABILITY HELPER FUNCTIONS
// ========================================

// Normal CDF approximation (error function based)
export function normalCDF(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

// Error function approximation
export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}

// Convert probability to American odds
export function probToAmericanOdds(prob: number): string {
  if (prob >= 1) return "+100";
  if (prob <= 0) return "+10000";

  if (prob >= 0.5) {
    const odds = -(prob / (1 - prob)) * 100;
    return Math.round(odds).toString();
  } else {
    const odds = ((1 - prob) / prob) * 100;
    return "+" + Math.round(odds).toString();
  }
}

export function generatePotentialBets(players: Player[], xgbPredictions?: Map<string, XGBoostPrediction>) {
  const bets: Array<{
    player_id: number;
    player_name: string;
    team: string;
    stat_type: string;
    line: number;
    hit_rate: number;
    season_avg: number;
    last_5_avg: number | null;
    recommendation: string;
    confidence: string;
    edge_type: string | null;
    edge_score: number | null;
    edge_description: string | null;
    xgb_prob_over: number | null;
    xgb_confidence: number | null;
    xgb_model_type: string | null;
    ml_explanation: {
      shap_drivers: Array<{ feature: string; shap_value: number; feature_value: number; direction: string }>;
      calibration: string;
      calibration_shift: number;
      raw_prob_over: number | null;
    } | null;
  }> = [];

  const statTypes = ["PTS", "REB", "AST", "PRA", "FG3M"];

  for (const player of players) {
    for (const statType of statTypes) {
      const hitRates = player.hit_rates[statType];
      if (!hitRates) continue;

      for (const [line, entry] of Object.entries(hitRates)) {
        const lineNum = parseFloat(line);
        const { rate, sampleSize } = parseHitRateEntry(entry as HitRateEntry);
        const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
        const last5Avg = player.last_5_averages[statType as keyof typeof player.last_5_averages];

        if (typeof seasonAvg !== "number") continue;
        if (sampleSize > 0 && sampleSize < BETTING_CONFIG.MIN_SAMPLE_SIZE) continue;

        // Get XGBoost prediction if available
        const xgbKey = `${player.player_name}_${statType}_${lineNum}`;
        const xgbPred = xgbPredictions?.get(xgbKey) || null;

        // Blend hit rate with XGBoost probability (40% XGB, 60% analytical)
        let blendedRate = rate;
        if (xgbPred) {
          const xgbRate = xgbPred.predicted_hit ? xgbPred.prob_over * 100 : (1 - xgbPred.prob_over) * 100;
          // For over: use prob_over; for under: use prob_under
          const analyticalProb = rate; // Already 0-100
          const xgbProb = xgbPred.prob_over * 100;
          blendedRate = 0.6 * analyticalProb + 0.4 * xgbProb;
        }

        let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
        let recommendation: "OVER" | "UNDER" = "OVER";

        if (blendedRate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_OVER) {
          confidence = "HIGH";
          recommendation = "OVER";
        } else if (blendedRate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_OVER) {
          confidence = "MEDIUM";
          recommendation = "OVER";
        } else if (blendedRate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_UNDER) {
          confidence = "HIGH";
          recommendation = "UNDER";
        } else if (blendedRate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_UNDER) {
          confidence = "MEDIUM";
          recommendation = "UNDER";
        }

        if (confidence !== "LOW") {
          const edgeAnalysis = analyzeEdges(player, statType, recommendation, rate);

          // XGBoost agreement bonus: if XGB strongly agrees, boost edge score
          let xgbEdgeBonus = 0;
          if (xgbPred && xgbPred.confidence > 0.3) {
            const xgbAgrees =
              (recommendation === "OVER" && xgbPred.prob_over > 0.6) ||
              (recommendation === "UNDER" && xgbPred.prob_under > 0.6);
            if (xgbAgrees) {
              xgbEdgeBonus = Math.round(xgbPred.confidence * 8); // Up to +8 edge score
            }
          }

          bets.push({
            player_id: player.player_id,
            player_name: player.player_name,
            team: player.team,
            stat_type: statType,
            line: lineNum,
            hit_rate: rate,
            season_avg: seasonAvg,
            last_5_avg: typeof last5Avg === "number" ? last5Avg : null,
            recommendation,
            confidence,
            edge_type: edgeAnalysis.bestEdge?.type || (xgbEdgeBonus > 0 ? "ML_MODEL" : null),
            edge_score: (edgeAnalysis.totalScore || 0) + xgbEdgeBonus,
            edge_description: xgbEdgeBonus > 0
              ? `${edgeAnalysis.bestEdge?.description || ""} | XGBoost: ${Number(((xgbPred?.prob_over || 0) * 100).toFixed(0))}% over (conf: ${Number(((xgbPred?.confidence || 0) * 100).toFixed(0))}%)`.trim()
              : edgeAnalysis.bestEdge?.description || null,
            xgb_prob_over: xgbPred?.prob_over || null,
            xgb_confidence: xgbPred?.confidence || null,
            xgb_model_type: xgbPred?.model_type || null,
            ml_explanation: xgbPred ? {
              shap_drivers: (xgbPred.shap_top_drivers || []).slice(0, 8),
              calibration: xgbPred.calibration_method || "none",
              calibration_shift: xgbPred.calibration_shift || 0,
              raw_prob_over: xgbPred.raw_prob_over ?? null,
            } : null,
          });
        }
      }
    }
  }

  // Sort by edge score first (highest priority), then by hit rate
  return bets.sort((a, b) => {
    // Prioritize bets with edges
    if (a.edge_score && !b.edge_score) return -1;
    if (!a.edge_score && b.edge_score) return 1;

    // Both have edges or both don't - sort by edge score
    if (a.edge_score && b.edge_score) {
      if (a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
    }

    // Same edge score or no edges - sort by confidence then hit rate
    if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
    if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;
    return b.hit_rate - a.hit_rate;
  });
}

/**
 * Generate potential bets from actual PrizePicks projections
 * This syncs our analysis with what's actually available on PrizePicks
 */

// Load today's projection outputs from the Python ML pipeline
// Joins via player_id since player_name is not stored in projection_outputs
async function loadTodayProjections(): Promise<Map<string, any>> {
  const projMap = new Map<string, any>();
  if (!pool) return projMap;

  // Map projection prop_type (full names) to PrizePicks abbreviations
  const PROP_TYPE_MAP: Record<string, string> = {
    "Points": "PTS",
    "Rebounds": "REB",
    "Assists": "AST",
    "3-Pointers Made": "FG3M",
    "Pts+Rebs+Asts": "PRA",
    "Pts+Rebs": "PR",
    "Pts+Asts": "PA",
    "Rebs+Asts": "RA",
    "Steals": "STL",
    "Blocks": "BLK",
    "Turnovers": "TO",
    "Blks+Stls": "Blks+Stls",
    "Fantasy Score": "FPTS",
  };

  try {
    const etOptions = { timeZone: "America/New_York" as const, year: "numeric" as const, month: "2-digit" as const, day: "2-digit" as const };
    const today = new Intl.DateTimeFormat("en-CA", etOptions).format(new Date());

    // Join projection_outputs with prizepicks_daily_lines to resolve player names
    // direction derived from sign of edge_pct (positive = OVER, negative = UNDER)
    const result = await pool.query(
      `SELECT DISTINCT ON (pdl.player_name, po.prop_type)
          pdl.player_name,
          po.prop_type,
          po.confidence_tier,
          CASE WHEN po.edge_pct >= 0 THEN 'OVER' ELSE 'UNDER' END AS direction,
          po.edge_pct,
          po.final_projection,
          po.baseline_projection,
          po.kelly_stake,
          po.signals_fired,
          po.signals_detail
       FROM projection_outputs po
       JOIN prizepicks_daily_lines pdl
         ON po.player_id = pdl.prizepicks_player_id
         AND po.game_date = pdl.game_date
         AND pdl.player_name NOT LIKE '% + %'
       WHERE po.game_date = $1
         AND po.confidence_tier NOT IN ('SKIP')
       ORDER BY pdl.player_name, po.prop_type, po.edge_pct DESC`,
      [today]
    );

    for (const row of result.rows) {
      const abbr = PROP_TYPE_MAP[row.prop_type] || row.prop_type;
      const key = (row.player_name + "|" + abbr).toLowerCase();
      projMap.set(key, { ...row, statTypeAbbr: abbr });
    }

    apiLogger.info("[Projections] Loaded " + projMap.size + " ML projections for " + today +
      " (SMASH=" + result.rows.filter((r: any) => r.confidence_tier === "SMASH").length +
      " STRONG=" + result.rows.filter((r: any) => r.confidence_tier === "STRONG").length +
      " LEAN=" + result.rows.filter((r: any) => r.confidence_tier === "LEAN").length + ")");
  } catch (e: any) {
    apiLogger.warn("[Projections] Could not load projection_outputs: " + e.message);
  }
  return projMap;
}

export async function generateBetsFromPrizePicks(players: Player[]) {
  const bets: Array<{
    player_id: number;
    player_name: string;
    team: string;
    stat_type: string;
    line: number;
    hit_rate: number;
    season_avg: number;
    last_5_avg: number | null;
    recommendation: string;
    confidence: string;
    edge_type: string | null;
    edge_score: number | null;
    edge_description: string | null;
    signal_score: number | null;
    signal_confidence: string | null;
    active_signals: string[] | null;
    signal_description: string | null;
  }> = [];

  try {
    // Load signal weights from database
    await loadSignalWeights(pool);

    // Load today's ML projections from Python pipeline output
    const todayProjections = await loadTodayProjections();


    // Fetch current PrizePicks projections
    const projections = await fetchPrizePicksProjections();
    apiLogger.info(`Fetched ${projections.length} PrizePicks projections`);

    // Create a player lookup map by name (case-insensitive)
    const playerMap = new Map<string, Player>();
    for (const player of players) {
      playerMap.set(player.player_name.toLowerCase(), player);
    }

    // For each PrizePicks projection, find the player and calculate hit rate
    for (const proj of projections) {
      const player = playerMap.get(proj.playerName.toLowerCase());

      const statType = proj.statTypeAbbr;
      const line = proj.line;

      let hitRate = 50; // Default: coin flip when no data
      let seasonAvg: number = line; // Default to line if no season avg
      let last5Avg: number | null = null;
      let sampleSize = 0;
      let hasPlayerData = false;

      if (player) {
        hasPlayerData = true;
        const hitRates = player.hit_rates[statType];

        if (hitRates) {
          // Find the closest line or exact match
          const lineStr = line.toString();
          let hitRateEntry = hitRates[lineStr] as HitRateEntry | undefined;

          if (hitRateEntry === undefined) {
            const lines = Object.keys(hitRates).map(l => parseFloat(l)).sort((a, b) => a - b);
            if (lines.length > 0) {
              const closestLine = lines.reduce((prev, curr) =>
                Math.abs(curr - line) < Math.abs(prev - line) ? curr : prev
              );
              hitRateEntry = hitRates[closestLine.toString()] as HitRateEntry | undefined;
            }
          }

          if (hitRateEntry !== undefined) {
            const parsed = parseHitRateEntry(hitRateEntry);
            hitRate = parsed.rate;
            sampleSize = parsed.sampleSize;
          }
        }

        const sa = player.season_averages[statType as keyof typeof player.season_averages];
        if (typeof sa === "number") seasonAvg = sa;
        const l5 = player.last_5_averages[statType as keyof typeof player.last_5_averages];
        if (typeof l5 === "number") last5Avg = l5;

        if (sampleSize > 0 && sampleSize < BETTING_CONFIG.MIN_SAMPLE_SIZE) {
          hitRate = 50; // Not enough data, treat as unknown
        }
      }

      let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
      let recommendation: "OVER" | "UNDER" = "OVER";

      if (hitRate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_OVER) {
        confidence = "HIGH";
        recommendation = "OVER";
      } else if (hitRate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_OVER) {
        confidence = "MEDIUM";
        recommendation = "OVER";
      } else if (hitRate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_UNDER) {
        confidence = "HIGH";
        recommendation = "UNDER";
      } else if (hitRate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_UNDER) {
        confidence = "MEDIUM";
        recommendation = "UNDER";
      }

      // For LOW confidence, infer recommendation from season avg vs line
      if (confidence === "LOW") {
        recommendation = (typeof seasonAvg === "number" && seasonAvg > line) ? "OVER" : "UNDER";
      }

      let edgeType: string | null = null;
      let edgeScore: number | null = null;
      let edgeDescription: string | null = null;
      let signalScoreVal: number | null = null;
      let signalConfidence: string | null = null;
      let activeSignals: string[] | null = null;
      let signalDesc: string | null = null;

      if (player) {
        const edgeAnalysis = analyzeEdges(player, statType, recommendation, hitRate);
        edgeType = edgeAnalysis.bestEdge?.type || null;
        edgeScore = edgeAnalysis.totalScore || null;
        edgeDescription = edgeAnalysis.bestEdge?.description || null;

        const signalResult = calculateSignalScore(
          player, statType, recommendation, hitRate, edgeAnalysis.edges
        );
        signalScoreVal = signalResult.signalScore || null;
        signalConfidence = signalResult.signalConfidence || null;
        activeSignals = signalResult.signals.length > 0 ? signalResult.signals : null;
        signalDesc = getSignalDescription(signalResult) || null;
      }

      // Override with ML model projections if available for today
      const mlKey = (proj.playerName + "|" + statType).toLowerCase();
      const mlProj = todayProjections ? todayProjections.get(mlKey) : null;

      if (mlProj) {
        recommendation = mlProj.direction === "OVER" ? "OVER" : mlProj.direction === "UNDER" ? "UNDER" : recommendation;
        confidence = (mlProj.confidence_tier === "SMASH" || mlProj.confidence_tier === "STRONG") ? "HIGH" :
                     mlProj.confidence_tier === "LEAN" ? "MEDIUM" : confidence;
      }

            bets.push({
        player_id: player?.player_id || 0,
        player_name: proj.playerName,
        team: proj.teamAbbr || player?.team || "",
        stat_type: statType,
        line: line,
        hit_rate: hitRate,
        season_avg: seasonAvg,
        last_5_avg: last5Avg,
        recommendation,
        confidence,
        edge_type: mlProj ? "ml_model" : edgeType,
        edge_score: mlProj && mlProj.edge_pct ? parseFloat(mlProj.edge_pct) : edgeScore,
        edge_description: mlProj ? ("ML: " + (mlProj.confidence_tier || "") + " " + (mlProj.direction || "") + " edge=" + (parseFloat(mlProj.edge_pct || 0).toFixed(1)) + "%") : edgeDescription,
        signal_score: signalScoreVal,
        signal_confidence: signalConfidence,
        active_signals: activeSignals,
        signal_description: signalDesc,
      });
    }

    const mlMatchedCount = bets.filter(b => b.edge_type === "ml_model").length;
    if (mlMatchedCount > 0) apiLogger.info("[ML Projections] Applied to " + mlMatchedCount + "/" + bets.length + " bets for today");

    // Sort by signal score first (backtest-backed), then edge score, then hit rate
    return bets.sort((a, b) => {
      // Priority 1: Signal score (backtest-proven signals)
      const aSignal = a.signal_score || 0;
      const bSignal = b.signal_score || 0;
      if (Math.abs(aSignal - bSignal) > 0.1) return bSignal - aSignal;

      // Priority 2: Signal confidence level
      if (a.signal_confidence === "HIGH" && b.signal_confidence !== "HIGH") return -1;
      if (b.signal_confidence === "HIGH" && a.signal_confidence !== "HIGH") return 1;

      // Priority 3: Edge score  
      if (a.edge_score && !b.edge_score) return -1;
      if (!a.edge_score && b.edge_score) return 1;
      if (a.edge_score && b.edge_score) {
        if (a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
      }

      // Priority 4: Basic confidence
      if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
      if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;

      return b.hit_rate - a.hit_rate;
    });
  } catch (error) {
    apiLogger.error("Error generating bets from PrizePicks:", error);
    // Fallback to generating from all hit rates if PrizePicks fetch fails
    apiLogger.info("Falling back to generating bets from all hit rates");
    return generatePotentialBets(players);
  }
}


/**
 * Enrich generated bets with calibration data (confidence tier, signal agreement, etc.)
 */
export async function enrichBetsWithCalibration(
  bets: Array<Record<string, any>>,
  players: Player[],
): Promise<Array<Record<string, any>>> {
  const playerMap = new Map(players.map(p => [p.player_id, p]));
  const enrichedBets = [];

  for (const bet of bets) {
    const player = playerMap.get(bet.player_id);
    if (!player) {
      enrichedBets.push(bet);
      continue;
    }

    try {
      const calibration = await calibrateBet(
        player,
        bet.stat_type,
        bet.line,
        bet.recommendation as 'OVER' | 'UNDER',
        bet.hit_rate,
        bet.season_avg,
        bet.last_5_avg,
      );

      enrichedBets.push({
        ...bet,
        confidence_tier: calibration.confidenceTier,
        signal_agreement: calibration.signalAgreement,
        calibrated_probability: calibration.calibratedProbability,
        agreeing_signals: calibration.agreeingSignals,
        total_signals: calibration.totalSignals,
        signal_details: calibration.signalDetails,
      });
    } catch (err) {
      console.error('[Calibration] Error for', bet.player_name, ':', err instanceof Error ? err.message : err);
      enrichedBets.push(bet);
    }
  }

  // Sort by tier priority
  const tierOrder: Record<string, number> = { SMASH: 0, STRONG: 1, LEAN: 2, AVOID: 3 };
  enrichedBets.sort((a, b) => {
    const aTier = tierOrder[a.confidence_tier || 'AVOID'] ?? 3;
    const bTier = tierOrder[b.confidence_tier || 'AVOID'] ?? 3;
    if (aTier !== bTier) return aTier - bTier;
    return (b.calibrated_probability ?? 0) - (a.calibrated_probability ?? 0);
  });

  const tiers = { SMASH: 0, STRONG: 0, LEAN: 0, AVOID: 0 };
  for (const b of enrichedBets) {
    const t = b.confidence_tier || 'AVOID';
    if (t in tiers) (tiers as Record<string, number>)[t] += 1;
  }
  console.log(`[Calibration] Enriched ${enrichedBets.length} bets: SMASH=${tiers['SMASH']}, STRONG=${tiers['STRONG']}, LEAN=${tiers['LEAN']}, AVOID=${tiers['AVOID']}`);

  return enrichedBets;
}


  // Helper: run a Python script and return parsed JSON output
export async function runPythonScript(
    scriptArgs: string[],
    timeoutMs: number = 30000
  ): Promise<{ data: any; error?: string }> {
    return new Promise((resolve) => {
      const pythonCmd = getPythonCommand();
      const scriptPath = path.join(
        __dirname,
        "nba-prop-model",
        "scripts",
        "cron_jobs.py"
      );
      const proc = spawn(pythonCmd, [scriptPath, ...scriptArgs], {
        cwd: "/var/www/courtsideedge/server/nba-prop-model",
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";
      proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

      const timer = setTimeout(() => {
        proc.kill();
        resolve({ data: null, error: "Script timed out" });
      }, timeoutMs);

      proc.on("close", (code: number) => {
        clearTimeout(timer);
        if (code !== 0) {
          resolve({ data: null, error: stderr || `Exit code ${code}` });
          return;
        }
        try {
          resolve({ data: JSON.parse(stdout.trim()) });
        } catch {
          resolve({ data: stdout.trim() });
        }
      });
    });
  }

  // Cache helper
export const signalCache: Map<string, { data: any; fetchedAt: number }> = new Map();
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getCached(key: string) {
  const entry = signalCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    signalCache.delete(key);
    return null;
  }
  return entry;
}

export function setCached(key: string, data: any) {
  signalCache.set(key, { data, fetchedAt: Date.now() });
}
