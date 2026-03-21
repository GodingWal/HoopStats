/**
 * Betting-related API routes
 *
 * Generates recommendations using sample-size-adjusted hit rates,
 * edge detection, and expected value filtering.
 */

import { Router } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { analyzeEdges } from "../edge-detection";
import { fetchPrizePicksProjections } from "../prizepicks-api";
import { generateBetExplanation, parseBetScreenshot } from "../services/openai";
import { BETTING_CONFIG } from "../constants";
import { validateBody, betSchema } from "../validation";
import type { Player, HitRateEntry } from "@shared/schema";
import { adjustedHitRate } from "../utils/statistics";
import { evaluateBetValue } from "../utils/ev-calculator";

const router = Router();

/**
 * Extract raw hit rate and sample size from a HitRateEntry,
 * handling both legacy (number) and new ({ rate, sampleSize }) formats.
 */
function parseHitRateEntry(entry: HitRateEntry): { rate: number; sampleSize: number } {
  if (typeof entry === "number") {
    return { rate: entry, sampleSize: 0 }; // Legacy format, no sample size
  }
  return { rate: entry.rate, sampleSize: entry.sampleSize };
}

/**
 * Determine confidence and recommendation from adjusted hit rate.
 * Uses Wilson-adjusted rate for sample-size-aware confidence thresholding.
 */
function classifyBet(
  rawRate: number,
  sampleSize: number,
): { confidence: "HIGH" | "MEDIUM" | "LOW"; recommendation: "OVER" | "UNDER"; adjustedRate: number } {
  const { CONFIDENCE_THRESHOLDS } = BETTING_CONFIG;

  // Determine direction first from raw rate
  const isOver = rawRate >= 50;
  const recommendation: "OVER" | "UNDER" = isOver ? "OVER" : "UNDER";

  // Use Wilson-adjusted rate for confidence (conservative estimate)
  const adjusted = sampleSize > 0
    ? adjustedHitRate(rawRate, sampleSize, recommendation)
    : rawRate; // No sample size available, use raw

  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";

  if (recommendation === "OVER") {
    if (adjusted >= CONFIDENCE_THRESHOLDS.HIGH_OVER) confidence = "HIGH";
    else if (adjusted >= CONFIDENCE_THRESHOLDS.MEDIUM_OVER) confidence = "MEDIUM";
  } else {
    if (adjusted <= CONFIDENCE_THRESHOLDS.HIGH_UNDER) confidence = "HIGH";
    else if (adjusted <= CONFIDENCE_THRESHOLDS.MEDIUM_UNDER) confidence = "MEDIUM";
  }

  return { confidence, recommendation, adjustedRate: Math.round(adjusted * 10) / 10 };
}

/**
 * Generate potential bets from player data
 */
function generatePotentialBets(players: Player[]) {
  const bets: Array<{
    player_id: number;
    player_name: string;
    team: string;
    stat_type: string;
    line: number;
    hit_rate: number;
    sample_size: number | null;
    adjusted_hit_rate: number | null;
    season_avg: number;
    last_5_avg: number | null;
    recommendation: string;
    confidence: string;
    edge_type: string | null;
    edge_score: number | null;
    edge_description: string | null;
    expected_value: number | null;
    kelly_size: number | null;
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

        // Skip bets with insufficient sample size when we know the sample size
        if (sampleSize > 0 && sampleSize < BETTING_CONFIG.MIN_SAMPLE_SIZE) continue;

        const { confidence, recommendation, adjustedRate } = classifyBet(rate, sampleSize);

        if (confidence !== "LOW") {
          const edgeAnalysis = analyzeEdges(player, statType, recommendation, rate);

          // Calculate Expected Value using adjusted probability
          const estimatedProb = adjustedRate / 100;
          const evResult = evaluateBetValue(
            recommendation === "OVER" ? estimatedProb : 1 - estimatedProb,
            BETTING_CONFIG.DEFAULT_ODDS,
            BETTING_CONFIG.MIN_EV_THRESHOLD
          );

          bets.push({
            player_id: player.player_id,
            player_name: player.player_name,
            team: player.team,
            stat_type: statType,
            line: lineNum,
            hit_rate: rate,
            sample_size: sampleSize > 0 ? sampleSize : null,
            adjusted_hit_rate: sampleSize > 0 ? adjustedRate : null,
            season_avg: seasonAvg,
            last_5_avg: typeof last5Avg === "number" ? last5Avg : null,
            recommendation,
            confidence,
            edge_type: edgeAnalysis.bestEdge?.type || null,
            edge_score: edgeAnalysis.totalScore || null,
            edge_description: edgeAnalysis.bestEdge?.description || null,
            expected_value: evResult.ev,
            kelly_size: evResult.quarterKelly,
          });
        }
      }
    }
  }

  return bets.sort((a, b) => {
    // Primary: EV (higher is better)
    const aEV = a.expected_value ?? -1;
    const bEV = b.expected_value ?? -1;
    if (aEV !== bEV) return bEV - aEV;
    // Secondary: edge score
    if (a.edge_score && !b.edge_score) return -1;
    if (!a.edge_score && b.edge_score) return 1;
    if (a.edge_score && b.edge_score && a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
    // Tertiary: confidence
    if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
    if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;
    return b.hit_rate - a.hit_rate;
  });
}

/**
 * Generate potential bets from PrizePicks projections
 */
async function generateBetsFromPrizePicks(players: Player[]) {
  const bets: Array<{
    player_id: number;
    player_name: string;
    team: string;
    stat_type: string;
    line: number;
    hit_rate: number;
    sample_size: number | null;
    adjusted_hit_rate: number | null;
    season_avg: number;
    last_5_avg: number | null;
    recommendation: string;
    confidence: string;
    edge_type: string | null;
    edge_score: number | null;
    edge_description: string | null;
    expected_value: number | null;
    kelly_size: number | null;
  }> = [];

  try {
    const projections = await fetchPrizePicksProjections();
    apiLogger.info(`Fetched ${projections.length} PrizePicks projections`);

    const playerMap = new Map<string, Player>();
    for (const player of players) {
      playerMap.set(player.player_name.toLowerCase(), player);
    }

    for (const proj of projections) {
      const player = playerMap.get(proj.playerName.toLowerCase());
      if (!player) continue;

      const statType = proj.statTypeAbbr;
      const line = proj.line;

      const hitRates = player.hit_rates[statType];
      if (!hitRates) continue;

      // Find hit rate for exact line or closest line
      const lineStr = line.toString();
      let hitRateEntry: HitRateEntry | undefined = hitRates[lineStr] as HitRateEntry | undefined;

      if (hitRateEntry === undefined) {
        const lines = Object.keys(hitRates).map(l => parseFloat(l)).sort((a, b) => a - b);
        if (lines.length === 0) continue;
        const closestLine = lines.reduce((prev, curr) =>
          Math.abs(curr - line) < Math.abs(prev - line) ? curr : prev
        );
        hitRateEntry = hitRates[closestLine.toString()] as HitRateEntry | undefined;
      }

      if (hitRateEntry === undefined) continue;

      const { rate, sampleSize } = parseHitRateEntry(hitRateEntry);
      const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
      const last5Avg = player.last_5_averages[statType as keyof typeof player.last_5_averages];

      if (typeof seasonAvg !== "number") continue;

      // Skip bets with insufficient sample size
      if (sampleSize > 0 && sampleSize < BETTING_CONFIG.MIN_SAMPLE_SIZE) continue;

      const { confidence, recommendation, adjustedRate } = classifyBet(rate, sampleSize);

      if (confidence !== "LOW") {
        const edgeAnalysis = analyzeEdges(player, statType, recommendation, rate);

        // Calculate Expected Value
        const estimatedProb = adjustedRate / 100;
        const evResult = evaluateBetValue(
          recommendation === "OVER" ? estimatedProb : 1 - estimatedProb,
          BETTING_CONFIG.DEFAULT_ODDS,
          BETTING_CONFIG.MIN_EV_THRESHOLD
        );

        bets.push({
          player_id: player.player_id,
          player_name: player.player_name,
          team: player.team,
          stat_type: statType,
          line: line,
          hit_rate: rate,
          sample_size: sampleSize > 0 ? sampleSize : null,
          adjusted_hit_rate: sampleSize > 0 ? adjustedRate : null,
          season_avg: seasonAvg,
          last_5_avg: typeof last5Avg === "number" ? last5Avg : null,
          recommendation,
          confidence,
          edge_type: edgeAnalysis.bestEdge?.type || null,
          edge_score: edgeAnalysis.totalScore || null,
          edge_description: edgeAnalysis.bestEdge?.description || null,
          expected_value: evResult.ev,
          kelly_size: evResult.quarterKelly,
        });
      }
    }

    return bets.sort((a, b) => {
      const aEV = a.expected_value ?? -1;
      const bEV = b.expected_value ?? -1;
      if (aEV !== bEV) return bEV - aEV;
      if (a.edge_score && !b.edge_score) return -1;
      if (!a.edge_score && b.edge_score) return 1;
      if (a.edge_score && b.edge_score && a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
      if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
      if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;
      return b.hit_rate - a.hit_rate;
    });
  } catch (error) {
    apiLogger.error("Error generating bets from PrizePicks", error);
    apiLogger.info("Falling back to generating bets from all hit rates");
    return generatePotentialBets(players);
  }
}

/**
 * POST /api/bets/refresh
 * Refresh bets from PrizePicks projections
 */
router.post("/refresh", async (req, res) => {
  try {
    apiLogger.info("Refreshing bets from PrizePicks...");

    const players = await storage.getPlayers();
    if (players.length === 0) {
      return res.json({
        success: false,
        betsCount: 0,
        message: "No player data available. Run data refresh first.",
      });
    }

    const generatedBets = await generateBetsFromPrizePicks(players);

    await storage.clearPotentialBets();
    for (const bet of generatedBets) {
      await storage.createPotentialBet(bet);
    }

    apiLogger.info(`Refreshed ${generatedBets.length} bets from PrizePicks`);

    res.json({
      success: true,
      betsCount: generatedBets.length,
      message: `Successfully refreshed ${generatedBets.length} betting opportunities from PrizePicks`
    });
  } catch (error) {
    apiLogger.error("Error refreshing bets", error);
    res.status(500).json({
      error: "Failed to refresh bets",
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /api/bets
 * Get all potential bets (filtered and sorted)
 */
router.get("/", async (req, res) => {
  try {
    let bets = await storage.getPotentialBets();

    if (bets.length === 0) {
      const players = await storage.getPlayers();
      if (players.length === 0) {
        return res.json([]);
      }
      const generatedBets = await generateBetsFromPrizePicks(players);
      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }
      bets = await storage.getPotentialBets();
    }

    const { EDGE_THRESHOLDS, HIT_RATE_THRESHOLDS, MAX_BETS_DISPLAY } = BETTING_CONFIG;

    // Filter to best bets - require positive EV when available
    const filteredBets = bets.filter(bet => {
      // If we have EV data, require positive EV above threshold
      if (bet.expected_value !== null && bet.expected_value !== undefined) {
        if (bet.expected_value < BETTING_CONFIG.MIN_EV_THRESHOLD) return false;
      }
      if (bet.confidence === "HIGH") return true;
      if (bet.edge_score && bet.edge_score >= EDGE_THRESHOLDS.STRONG) return true;
      if (bet.edge_score && bet.edge_score >= EDGE_THRESHOLDS.GOOD) {
        if (bet.hit_rate >= HIT_RATE_THRESHOLDS.STRONG_OVER || bet.hit_rate <= HIT_RATE_THRESHOLDS.STRONG_UNDER) return true;
      }
      if (bet.hit_rate >= HIT_RATE_THRESHOLDS.EXTREME_OVER || bet.hit_rate <= HIT_RATE_THRESHOLDS.EXTREME_UNDER) return true;
      return false;
    });

    // Sort by EV, then edge score, then confidence, then hit rate deviation
    const sortedBets = filteredBets.sort((a, b) => {
      // Primary: EV
      const aEV = a.expected_value ?? -1;
      const bEV = b.expected_value ?? -1;
      if (aEV !== bEV) return bEV - aEV;
      // Secondary: edge score
      if (a.edge_score && !b.edge_score) return -1;
      if (!a.edge_score && b.edge_score) return 1;
      if (a.edge_score && b.edge_score && a.edge_score !== b.edge_score) return b.edge_score - a.edge_score;
      // Tertiary: confidence
      if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
      if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;
      const aDeviation = Math.abs(a.hit_rate - 50);
      const bDeviation = Math.abs(b.hit_rate - 50);
      return bDeviation - aDeviation;
    });

    const limitedBets = sortedBets.slice(0, MAX_BETS_DISPLAY);
    res.json(limitedBets);
  } catch (error) {
    apiLogger.error("Error fetching bets", error);
    res.status(500).json({ error: "Failed to fetch bets" });
  }
});

/**
 * GET /api/bets/top-picks
 * Get top 10 best picks based on edge analysis and EV
 */
router.get("/top-picks", async (req, res) => {
  try {
    let bets = await storage.getPotentialBets();

    if (bets.length === 0) {
      const players = await storage.getPlayers();
      if (players.length === 0) {
        return res.json([]);
      }
      const generatedBets = generatePotentialBets(players);
      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }
      bets = await storage.getPotentialBets();
    }

    const betsWithEdges = bets.filter(b => b.edge_score && b.edge_score > 0);
    const topPicks = betsWithEdges.slice(0, 10);

    res.json(topPicks);
  } catch (error) {
    apiLogger.error("Error fetching top picks", error);
    res.status(500).json({ error: "Failed to fetch top picks" });
  }
});

/**
 * GET /api/bets/status
 * Health check - reports data freshness
 */
router.get("/status", async (req, res) => {
  try {
    const players = await storage.getPlayers();
    const bets = await storage.getPotentialBets();

    res.json({
      hasPlayerData: players.length > 0,
      playerCount: players.length,
      betCount: bets.length,
      dataStatus: players.length === 0 ? "No data - run refresh" : "Ready",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to check status" });
  }
});

/**
 * POST /api/explain
 * Generate AI explanation for a bet
 */
router.post("/explain", async (req, res) => {
  try {
    const { player_name, prop, line, side, season_average, last_5_average, hit_rate, opponent } = req.body;

    if (!player_name || !prop || !line || !side) {
      return res.status(400).json({ error: "Missing required bet details" });
    }

    const explanation = await generateBetExplanation({
      player_name,
      prop,
      line,
      side,
      season_average: season_average || 0,
      last_5_average: last_5_average || 0,
      hit_rate: hit_rate || 0,
      opponent: opponent || "Unknown",
    });

    res.json({ explanation });
  } catch (error) {
    apiLogger.error("Error generating explanation", error);
    res.status(500).json({ error: "Failed to generate explanation" });
  }
});

/**
 * POST /api/bets/upload-screenshot
 * Parse a screenshot of a betting slip
 */
router.post("/upload-screenshot", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Missing image data" });
    }

    // Extract media type and strip data URL prefix
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

/**
 * POST /api/bets/user
 * Save a user bet
 */
router.post("/user", async (req, res) => {
  try {
    const bet = req.body;
    const savedBet = await storage.saveUserBet(bet);
    res.json(savedBet);
  } catch (error) {
    apiLogger.error("Error saving user bet", error);
    res.status(500).json({ error: "Failed to save bet" });
  }
});

/**
 * GET /api/bets/user
 * Get user bets
 */
router.get("/user", async (req, res) => {
  try {
    const pending = req.query.pending === 'true';
    const gameDate = req.query.gameDate as string | undefined;

    const bets = await storage.getUserBets({ pending, gameDate });
    res.json(bets);
  } catch (error) {
    apiLogger.error("Error fetching user bets", error);
    res.status(500).json({ error: "Failed to fetch user bets" });
  }
});

/**
 * PATCH /api/bets/user/:betId
 * Update user bet result
 */
router.patch("/user/:betId", async (req, res) => {
  try {
    const betId = parseInt(req.params.betId, 10);
    const { result, actualValue, profit } = req.body;

    if (isNaN(betId) || !result || actualValue === undefined || profit === undefined) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    await storage.updateUserBetResult(betId, result, actualValue, profit);
    res.json({ success: true });
  } catch (error) {
    apiLogger.error("Error updating bet result", error);
    res.status(500).json({ error: "Failed to update bet result" });
  }
});

// Export functions for use in other modules
export { generatePotentialBets, generateBetsFromPrizePicks };
export default router;
