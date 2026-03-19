import type { Express } from "express";
import { createServer, type Server } from "http";
import { spawn } from "child_process";
import path from "path";

import { storage } from "./storage";
import { pool } from "./db";
import type { Player } from "@shared/schema";
import { BETTING_CONFIG } from "./constants";
import { apiLogger } from "./logger";
import { fetchAndBuildAllPlayers } from "./nba-api";
import { analyzeEdges } from "./edge-detection";
import { loadSignalWeights, calculateSignalScore, hasStrongSignalSupport, getSignalDescription } from "./signal-scoring";
import {
  fetchLiveGames,
  fetchPlayerGamelog,
  fetchGameBoxScore,
  fetchTeamRoster,
  fetchTodaysGameInjuries,
  fetchAllNbaInjuries,
  getTeamOutPlayers,
  type PlayerInjuryReport,
} from "./espn-api";
import { fetchNbaEvents, fetchEventPlayerProps, isOddsApiConfigured, getOddsApiStatus, extractGameOdds } from "./odds-api";
import { fetchPrizePicksProjections, fetchPlayerPrizePicksProps, getScraperStatus, rotateScraperSession, addScraperProxies, resetFailedProxies, resetScraperStats } from "./prizepicks-api";
import { prizePicksLineTracker } from "./prizepicks-line-tracker";
import { prizePicksStorage } from "./storage/prizepicks-storage";
import {
  injuryWatcher,
  calculateInjuryAdjustedProjection,
  calculateInjuryEdgeChange,
} from "./injury-watcher";
import { onOffService } from "./on-off-service";
import {
  fetchTeamStats,
  fetchTeamRecentGames,
  fetchTeamRotation,
  compareTeams,
  getAllTeamsInfo,
  getTeamInfo,
} from "./team-stats-api";
import { generateBetExplanation } from "./services/openai";
import { registerRefSignalRoutes } from "./routes/ref-signal";
import { lineWatcher } from "./services/line-watcher";
import { SAMPLE_PLAYERS } from "./data/sample-players-loader";

// Get the Python command - use venv on Linux (production), system python on Windows (dev)
function getPythonCommand(): string {
  if (process.platform === 'win32') {
    return 'python';
  }
  // On Linux, use the venv Python in the nba-prop-model directory
  const venvPath = path.join(process.cwd(), 'server', 'nba-prop-model', 'venv', 'bin', 'python');
  // Fallback to system python3 if venv doesn't exist
  return venvPath;
}

// ========================================
// PROBABILITY HELPER FUNCTIONS
// ========================================

// Normal CDF approximation (error function based)
function normalCDF(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

// Error function approximation
function erf(x: number): number {
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
function probToAmericanOdds(prob: number): string {
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

function generatePotentialBets(players: Player[]) {
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
  }> = [];

  const statTypes = ["PTS", "REB", "AST", "PRA", "FG3M"];

  for (const player of players) {
    for (const statType of statTypes) {
      const hitRates = player.hit_rates[statType];
      if (!hitRates) continue;

      for (const [line, rate] of Object.entries(hitRates)) {
        const lineNum = parseFloat(line);
        const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
        const last5Avg = player.last_5_averages[statType as keyof typeof player.last_5_averages];

        if (typeof seasonAvg !== "number") continue;

        let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
        let recommendation: "OVER" | "UNDER" = "OVER";

        if (rate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_OVER) {
          confidence = "HIGH";
          recommendation = "OVER";
        } else if (rate >= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_OVER) {
          confidence = "MEDIUM";
          recommendation = "OVER";
        } else if (rate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.HIGH_UNDER) {
          confidence = "HIGH";
          recommendation = "UNDER";
        } else if (rate <= BETTING_CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM_UNDER) {
          confidence = "MEDIUM";
          recommendation = "UNDER";
        }

        if (confidence !== "LOW") {
          // Analyze edges for this bet
          const edgeAnalysis = analyzeEdges(player, statType, recommendation, rate);

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
            edge_type: edgeAnalysis.bestEdge?.type || null,
            edge_score: edgeAnalysis.totalScore || null,
            edge_description: edgeAnalysis.bestEdge?.description || null,
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
async function generateBetsFromPrizePicks(players: Player[]) {
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
      if (!player) {
        apiLogger.info(`Player not found in DB: ${proj.playerName}`);
        continue;
      }

      const statType = proj.statTypeAbbr;
      const line = proj.line;

      // Get hit rates for this stat type
      const hitRates = player.hit_rates[statType];
      if (!hitRates) continue;

      // Find the closest line or exact match
      const lineStr = line.toString();
      let hitRate = hitRates[lineStr];

      // If exact line not found, interpolate or find closest
      if (hitRate === undefined) {
        const lines = Object.keys(hitRates).map(l => parseFloat(l)).sort((a, b) => a - b);
        const closestLine = lines.reduce((prev, curr) =>
          Math.abs(curr - line) < Math.abs(prev - line) ? curr : prev
        );
        hitRate = hitRates[closestLine.toString()];
        apiLogger.info(`Using closest line ${closestLine} for ${proj.playerName} ${statType} ${line} (hit rate: ${hitRate}%)`);
      }

      if (hitRate === undefined) continue;

      const seasonAvg = player.season_averages[statType as keyof typeof player.season_averages];
      const last5Avg = player.last_5_averages[statType as keyof typeof player.last_5_averages];

      if (typeof seasonAvg !== "number") continue;

      // Determine confidence and recommendation based on hit rate
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

      // Only create bets with at least MEDIUM confidence
      if (confidence !== "LOW") {
        // Analyze edges for this bet
        const edgeAnalysis = analyzeEdges(player, statType, recommendation, hitRate);

        // Calculate signal-based score using learned weights from backtest
        const signalScore = calculateSignalScore(
          player,
          statType,
          recommendation,
          hitRate,
          edgeAnalysis.edges
        );

        bets.push({
          player_id: player.player_id,
          player_name: player.player_name,
          team: player.team,
          stat_type: statType,
          line: line,
          hit_rate: hitRate,
          season_avg: seasonAvg,
          last_5_avg: typeof last5Avg === "number" ? last5Avg : null,
          recommendation,
          confidence,
          edge_type: edgeAnalysis.bestEdge?.type || null,
          edge_score: edgeAnalysis.totalScore || null,
          edge_description: edgeAnalysis.bestEdge?.description || null,
          signal_score: signalScore.signalScore || null,
          signal_confidence: signalScore.signalConfidence || null,
          active_signals: signalScore.signals.length > 0 ? signalScore.signals : null,
          signal_description: getSignalDescription(signalScore) || null,
        });
      }
    }

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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/players", async (req, res) => {
    try {
      let players = await storage.getPlayers();
      if (players.length === 0) {
        await storage.seedPlayers(SAMPLE_PLAYERS);
        players = await storage.getPlayers();
      }

      // Enrich players with injury status
      const allInjuries = injuryWatcher.getKnownInjuries();
      const playersWithInjuries = players.map(player => {
        const playerInjury = allInjuries.find(inj =>
          player.player_name.toLowerCase().includes(inj.playerName.toLowerCase()) ||
          inj.playerName.toLowerCase().includes(player.player_name.toLowerCase())
        );

        return {
          ...player,
          injury_status: playerInjury ? {
            status: playerInjury.status,
            description: playerInjury.description,
            isOut: playerInjury.status === 'out',
          } : null,
        };
      });

      res.json(playersWithInjuries);
    } catch (error) {
      apiLogger.error("Error fetching players:", error);
      res.status(500).json({ error: "Failed to fetch players" });
    }
  });

  app.get("/api/players/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid player ID" });
      }

      const player = await storage.getPlayer(id);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Check if player is currently injured
      const teamInjuredPlayers = injuryWatcher.getTeamOutPlayers(player.team);
      const isInjured = teamInjuredPlayers.some(injuredName =>
        player.player_name.toLowerCase().includes(injuredName.toLowerCase()) ||
        injuredName.toLowerCase().includes(player.player_name.toLowerCase())
      );

      // Get full injury details if injured
      let injuryStatus = null;
      if (isInjured) {
        const allInjuries = injuryWatcher.getKnownInjuries();
        const playerInjury = allInjuries.find(inj =>
          player.player_name.toLowerCase().includes(inj.playerName.toLowerCase()) ||
          inj.playerName.toLowerCase().includes(player.player_name.toLowerCase())
        );
        if (playerInjury) {
          injuryStatus = {
            status: playerInjury.status,
            description: playerInjury.description,
            isOut: playerInjury.status === 'out',
          };
        }
      }

      res.json({
        ...player,
        injury_status: injuryStatus,
      });
    } catch (error) {
      apiLogger.error("Error fetching player:", error);
      res.status(500).json({ error: "Failed to fetch player" });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      let players;

      if (!query || query.trim().length === 0) {
        players = await storage.getPlayers();
      } else {
        players = await storage.searchPlayers(query.trim());
      }

      // Enrich with injury status
      const allInjuries = injuryWatcher.getKnownInjuries();
      const playersWithInjuries = players.map(player => {
        const playerInjury = allInjuries.find(inj =>
          player.player_name.toLowerCase().includes(inj.playerName.toLowerCase()) ||
          inj.playerName.toLowerCase().includes(player.player_name.toLowerCase())
        );

        return {
          ...player,
          injury_status: playerInjury ? {
            status: playerInjury.status,
            description: playerInjury.description,
            isOut: playerInjury.status === 'out',
          } : null,
        };
      });

      res.json(playersWithInjuries);
    } catch (error) {
      apiLogger.error("Error searching players:", error);
      res.status(500).json({ error: "Failed to search players" });
    }
  });

  // Refresh bets from current PrizePicks projections
  app.post("/api/bets/refresh", async (req, res) => {
    try {
      apiLogger.info("Refreshing bets from PrizePicks...");

      let players = await storage.getPlayers();
      if (players.length === 0) {
        await storage.seedPlayers(SAMPLE_PLAYERS);
        players = await storage.getPlayers();
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
      apiLogger.error("Error refreshing bets:", error);
      res.status(500).json({
        error: "Failed to refresh bets",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/bets", async (req, res) => {
    try {
      // Load signal weights for enrichment
      await loadSignalWeights(pool);

      let bets = await storage.getPotentialBets();
      if (bets.length === 0) {
        let players = await storage.getPlayers();
        if (players.length === 0) {
          await storage.seedPlayers(SAMPLE_PLAYERS);
          players = await storage.getPlayers();
        }
        const generatedBets = await generateBetsFromPrizePicks(players);
        await storage.clearPotentialBets();
        for (const bet of generatedBets) {
          await storage.createPotentialBet(bet);
        }
        bets = await storage.getPotentialBets();
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

      // Filter to only show the BEST bets - those with meaningful edges or high confidence
      // Criteria for "best bets":
      // 1. HIGH confidence (hit rate >= 80% or <= 25%)
      // 2. Edge score >= 5 (meaningful edge detected)
      // 3. Hit rate >= 75% (OVER) or <= 30% (UNDER) with any edge
      // 4. HIGH signal confidence from backtest
      const filteredBets = enrichedBets.filter(bet => {
        // Always include HIGH confidence bets
        if (bet.confidence === "HIGH") return true;

        // Include bets with strong edges (score >= 5)
        if (bet.edge_score && bet.edge_score >= 5) return true;

        // Include bets with good edges (score >= 3) AND strong hit rates
        if (bet.edge_score && bet.edge_score >= 3) {
          if (bet.hit_rate >= 75 || bet.hit_rate <= 30) return true;
        }

        // Include extreme hit rates even without edges
        if (bet.hit_rate >= 78 || bet.hit_rate <= 22) return true;

        // Include bets with HIGH signal confidence
        if ((bet as any).signal_confidence === "HIGH") return true;

        return false;
      });

      // Sort by signal score first (backtest-backed), then edge score, then hit rate
      const sortedBets = filteredBets.sort((a, b) => {
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

      // Limit to top 50 bets to avoid overwhelming the UI
      const limitedBets = sortedBets.slice(0, 50);

      res.json(limitedBets);
    } catch (error) {
      apiLogger.error("Error fetching bets:", error);
      res.status(500).json({ error: "Failed to fetch bets" });
    }
  });

  // Get top 10 best picks based on edge analysis
  app.get("/api/bets/top-picks", async (req, res) => {
    try {
      let bets = await storage.getPotentialBets();
      if (bets.length === 0) {
        let players = await storage.getPlayers();
        if (players.length === 0) {
          await storage.seedPlayers(SAMPLE_PLAYERS);
          players = await storage.getPlayers();
        }
        const generatedBets = generatePotentialBets(players);
        await storage.clearPotentialBets();
        for (const bet of generatedBets) {
          await storage.createPotentialBet(bet);
        }
        bets = await storage.getPotentialBets();
      }

      // Filter for bets with edges and get top 10
      const betsWithEdges = bets.filter(b => b.edge_score && b.edge_score > 0);
      const topPicks = betsWithEdges.slice(0, 10);

      res.json(topPicks);
    } catch (error) {
      apiLogger.error("Error fetching top picks:", error);
      res.status(500).json({ error: "Failed to fetch top picks" });
    }
  });

  // NOTE: Duplicate /api/bets/refresh route removed - using PrizePicks version above

  app.post("/api/explain", async (req, res) => {
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
      apiLogger.error("Error generating explanation:", error);
      res.status(500).json({ error: "Failed to generate explanation" });
    }
  });

  // Alerts API
  app.get("/api/alerts", async (req, res) => {
    try {
      const alerts = await storage.getAlerts({ limit: 20 });
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    try {
      await storage.markAlertAsRead(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark alert as read" });
    }
  });

  // Start background services
  lineWatcher.start();

  app.get("/api/sync/status", async (req, res) => {
    res.json({
      apiConfigured: true,
      message: "ESPN API is configured (Public). You can sync NBA data."
    });
  });

  app.post("/api/admin/sync-rosters", async (req, res) => {
    try {
      apiLogger.info("Starting NBA roster sync via ESPN...");

      const players = await fetchAndBuildAllPlayers((current, total) => {
        if (current % 50 === 0) {
          apiLogger.info(`Progress: ${current}/${total} players processed`);
        }
      });

      apiLogger.info(`Syncing ${players.length} players to database...`);

      // Clear existing players (sample data has different IDs than ESPN data)
      await storage.clearPlayers();

      // Use syncPlayers to upsert data (now effective seed since we cleared)
      await storage.syncPlayers(players);

      // Generate bets based on the new data
      // Note: bets generation might need players with ID, but syncPlayers updates DB.
      // We should fetch players from DB to get generated IDs if needed for bets?
      // PotentialBets schema has `player_id` (integer).
      // If `InsertPlayer` had `player_id` (external ID), usually we use that.
      // Schema: `potential_bets.player_id` is integer. `players.player_id` is integer (external).
      // So consistent usage of external ID is fine.
      // But `generatePotentialBets` takes `Player[]`. `players` here is `InsertPlayer[]`.
      // We should fetch fresh from DB to be safe and match types.

      const dbPlayers = await storage.getPlayers();

      // Generate bets from actual PrizePicks lines
      apiLogger.info("Fetching PrizePicks projections to sync bets...");
      const generatedBets = await generateBetsFromPrizePicks(dbPlayers);

      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }

      apiLogger.info("Sync complete!");

      res.json({
        success: true,
        playersCount: players.length,
        betsCount: generatedBets.length,
        message: `Successfully synced ${players.length} NBA players and generated ${generatedBets.length} betting opportunities.`
      });
    } catch (error) {
      apiLogger.error("Error syncing players:", error);
      res.status(500).json({
        error: "Failed to sync players",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Alias for backward compatibility or frontend usage
  app.post("/api/sync/players", async (req, res) => {
    // Redirect to admin sync
    res.redirect(307, "/api/admin/sync-rosters");
  });

  app.get("/api/live-games", async (req, res) => {
    try {
      // Accept date param in format YYYYMMDD
      const dateStr = req.query.date as string | undefined;
      const games = await fetchLiveGames(dateStr);

      // Only fetch odds if no date specified (today) or date is today/future
      // For simplicity, we'll try to fetch odds if we have games and it looks like today/upcoming
      if (games.length > 0) {
        try {
          // Only fetch odds for today's games or upcoming. 
          // The Odds API mainly returns upcoming/live odds.
          const oddsEvents = await fetchNbaEvents();

          // Merge odds into games
          for (const game of games) {
            const homeTeam = game.competitors.find(c => c.homeAway === 'home')?.team;
            const awayTeam = game.competitors.find(c => c.homeAway === 'away')?.team;

            if (!homeTeam || !awayTeam) continue;

            // Find matching odds event
            // Match by team names. Odds API uses full names e.g. "Los Angeles Lakers"
            // ESPN uses "Lakers" and "LAL".
            // We'll check if Odds API team name includes ESPN team name

            const match = oddsEvents.find(e => {
              const homeMatch = e.home_team.includes(homeTeam.name) || e.home_team.includes(homeTeam.displayName);
              const awayMatch = e.away_team.includes(awayTeam.name) || e.away_team.includes(awayTeam.displayName);
              return homeMatch && awayMatch;
            });

            if (match) {
              // Check if there are valid odds to extract, assuming extractGameOdds is imported
              const gameOdds = extractGameOdds(match);
              if (gameOdds) {
                // Convert favorite full name to abbreviation if possible, or keep as is
                // If favorite matches home team name, use home abbr, else away abbr
                let favAbbr = gameOdds.favorite;
                if (gameOdds.favorite === match.home_team) {
                  favAbbr = homeTeam.abbreviation;
                } else if (gameOdds.favorite === match.away_team) {
                  favAbbr = awayTeam.abbreviation;
                }

                game.gameOdds = {
                  ...gameOdds,
                  favorite: favAbbr
                };
              }
            }
          }
        } catch (oddsError) {
          apiLogger.error("Error fetching/merging odds:", oddsError);
          // Verify we don't fail the whole request if odds fail
        }
      }

      res.json(games);
    } catch (error) {
      apiLogger.error("Error fetching live games:", error);
      res.status(500).json({ error: "Failed to fetch live games" });
    }
  });

  // Get game box score / details
  app.get("/api/games/:gameId", async (req, res) => {
    try {
      const { gameId } = req.params;
      if (!gameId) {
        return res.status(400).json({ error: "Missing game ID" });
      }
      const boxScore = await fetchGameBoxScore(gameId);
      if (!boxScore) {
        return res.status(404).json({ error: "Game not found" });
      }
      res.json(boxScore);
    } catch (error) {
      apiLogger.error("Error fetching game details:", error);
      res.status(500).json({ error: "Failed to fetch game details" });
    }
  });

  // Get team roster
  app.get("/api/teams/:teamId/roster", async (req, res) => {
    try {
      const { teamId } = req.params;
      if (!teamId) {
        return res.status(400).json({ error: "Missing team ID" });
      }
      const roster = await fetchTeamRoster(teamId);
      res.json(roster);
    } catch (error) {
      apiLogger.error("Error fetching team roster:", error);
      res.status(500).json({ error: "Failed to fetch team roster" });
    }
  });

  app.get("/api/players/:id/gamelog", async (req, res) => {
    try {
      const playerId = req.params.id;
      if (!playerId) {
        return res.status(400).json({ error: "Missing player ID" });
      }

      const gamelog = await fetchPlayerGamelog(playerId);
      res.json(gamelog);
    } catch (error) {
      apiLogger.error("Error fetching player gamelog:", error);
      res.status(500).json({ error: "Failed to fetch player gamelog" });
    }
  });

  app.post("/api/projections", async (req, res) => {
    try {
      const { players, includeInjuries = true } = req.body;
      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");

      // Build command args
      const args = ["--players", ...players];

      // If includeInjuries is true, fetch current injuries and include them
      let injuredPlayers: string[] = [];
      if (includeInjuries) {
        try {
          // Get today's injuries
          const injuries = await fetchTodaysGameInjuries();

          const injuredMinutesMap: Record<string, number> = {};

          injuries.forEach(inj => {
            if (inj.status === 'out') {
              // Default to 25 minutes for now until we lookup actual averages
              injuredMinutesMap[inj.playerName] = 25.0;
              injuredPlayers.push(inj.playerName);
            }
          });

          if (injuredPlayers.length > 0) {
            args.push("--injured_minutes", JSON.stringify(injuredMinutesMap));
          }
        } catch (injError) {
          apiLogger.warn("Could not fetch injuries for projections:", injError);
          // Continue without injury data
        }
      }

      apiLogger.info(`Running python script: ${scriptPath} with players: ${players.join(", ")}`);
      if (injuredPlayers.length > 0) {
        apiLogger.info(`  Injuries factored in: ${injuredPlayers.join(", ")}`);
      }

      const pythonProcess = spawn(getPythonCommand(), [scriptPath, ...args]);

      let dataString = "";
      let errorString = "";

      pythonProcess.on("error", (err) => {
        apiLogger.error("Failed to start Python process", err);
        res.status(500).json({ error: "Failed to start model process", details: err.message });
      });

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          // Add injury context to response
          res.json({
            ...json,
            injuryContext: {
              injuriesIncluded: includeInjuries,
              injuredPlayers: injuredPlayers,
              injuryCount: injuredPlayers.length,
            }
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output. Data:", dataString);
          apiLogger.error("Stderr:", errorString);
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating projections:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== ENHANCED PROJECTIONS & ANALYTICS ROUTES ===============

  // Get best betting recommendations for today
  app.get("/api/recommendations/today", async (req, res) => {
    try {
      const minEdge = parseFloat(req.query.minEdge as string) || 0.03;
      const recommendations = await storage.getTodaysRecommendations();
      const filtered = recommendations.filter(r => r.edge >= minEdge);
      res.json(filtered);
    } catch (error) {
      apiLogger.error("Error fetching today's recommendations:", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // Get projection and edge for specific player/prop
  app.get("/api/projections/player/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const line = parseFloat(req.query.line as string);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || isNaN(line) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      // Get player data
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ error: "Player not found" });
      }

      // Call Python model to get projection with distribution
      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
      const pythonProcess = spawn(getPythonCommand(), [scriptPath, "--players", player.player_name]);

      let dataString = "";
      let errorString = "";

      pythonProcess.on("error", (err) => {
        apiLogger.error("Failed to start Python process", err);
        res.status(500).json({ error: "Failed to start model process", details: err.message });
      });

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projection failed", details: errorString });
        }
        try {
          const projectionData = JSON.parse(dataString);
          const playerProj = projectionData.projections[0];

          if (!playerProj || !playerProj.distributions[stat]) {
            return res.status(400).json({ error: `No projection available for stat: ${stat}` });
          }

          const dist = playerProj.distributions[stat];
          const mean = dist.mean;
          const std = dist.std;

          // Calculate probabilities (assuming normal distribution)
          const probOver = 1 - normalCDF(line, mean, std);
          const probUnder = normalCDF(line, mean, std);

          // Calculate edge (assuming -110 odds, break-even = 52.4%)
          const breakEven = BETTING_CONFIG.BREAK_EVEN_PROB;
          const edgeOver = probOver - breakEven;
          const edgeUnder = probUnder - breakEven;

          const edge = Math.max(edgeOver, edgeUnder);
          const recommendedSide = edgeOver > edgeUnder ? 'over' : 'under';
          const confidence = edge > 0.06 ? 'high' : edge > 0.03 ? 'medium' : 'low';

          res.json({
            playerId,
            playerName: player.player_name,
            stat,
            line,
            projectedMean: mean,
            projectedStd: std,
            probOver,
            probUnder,
            edge: Math.abs(edge),
            recommendedSide: edge >= 0.03 ? recommendedSide : 'no_bet',
            confidence,
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output:", dataString);
          res.status(500).json({ error: "Invalid response from model" });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating projection:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Evaluate a parlay
  app.post("/api/projections/parlay", async (req, res) => {
    try {
      const { legs } = req.body;

      if (!legs || !Array.isArray(legs) || legs.length === 0) {
        return res.status(400).json({ error: "Invalid legs array" });
      }

      // Get projections for each leg
      const probabilities: number[] = [];

      for (const leg of legs) {
        const player = await storage.getPlayer(leg.playerId);
        if (!player) {
          return res.status(404).json({ error: `Player not found: ${leg.playerId}` });
        }

        // Call Python model for this player
        const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
        const pythonProcess = spawn(getPythonCommand(), [scriptPath, "--players", player.player_name]);

        const projection = await new Promise<number>((resolve, reject) => {
          let dataString = "";

          pythonProcess.on("error", (err) => {
            reject(new Error(`Failed to start Python process: ${err.message}`));
          });

          pythonProcess.stdout.on("data", (data) => {
            dataString += data.toString();
          });

          pythonProcess.on("close", (code) => {
            if (code !== 0) {
              reject(new Error("Python script failed"));
              return;
            }
            try {
              const projectionData = JSON.parse(dataString);
              const playerProj = projectionData.projections[0];
              const dist = playerProj.distributions[leg.stat];
              const mean = dist.mean;
              const std = dist.std;

              const prob = leg.side === 'over'
                ? 1 - normalCDF(leg.line, mean, std)
                : normalCDF(leg.line, mean, std);

              resolve(prob);
            } catch (e) {
              reject(e);
            }
          });
        });

        probabilities.push(projection);
      }

      // Calculate parlay probability (product of individual probabilities)
      const parlayProb = probabilities.reduce((acc, p) => acc * p, 1);

      // Convert to American odds
      const fairOdds = probToAmericanOdds(parlayProb);

      res.json({
        probability: parlayProb,
        fairOdds,
        legs: legs.length,
        individualProbs: probabilities,
      });
    } catch (error) {
      apiLogger.error("Error evaluating parlay:", error);
      res.status(500).json({ error: "Failed to evaluate parlay" });
    }
  });

  // Get track record
  app.get("/api/track-record", async (req, res) => {
    try {
      const days = parseInt(req.query.days as string) || 30;
      const record = await storage.getTrackRecord(days);
      res.json(record);
    } catch (error) {
      apiLogger.error("Error fetching track record:", error);
      res.status(500).json({ error: "Failed to fetch track record" });
    }
  });

  // =============== LINE TRACKING ROUTES ===============

  // Get all sportsbooks
  app.get("/api/sportsbooks", async (req, res) => {
    try {
      const books = await storage.getSportsbooks();
      res.json(books);
    } catch (error) {
      apiLogger.error("Error fetching sportsbooks:", error);
      res.status(500).json({ error: "Failed to fetch sportsbooks" });
    }
  });

  // Get player prop lines
  app.get("/api/lines/player/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const lines = await storage.getPlayerPropLines(playerId, stat, gameDate);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching player lines:", error);
      res.status(500).json({ error: "Failed to fetch player lines" });
    }
  });

  // Get latest lines for a player/stat
  app.get("/api/lines/latest/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const lines = await storage.getLatestLines(playerId, stat);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching latest lines:", error);
      res.status(500).json({ error: "Failed to fetch latest lines" });
    }
  });

  // Get line comparison for a player (all sportsbooks)
  app.get("/api/lines/compare/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string;

      if (isNaN(playerId) || !stat || !gameDate) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const comparison = await storage.compareLines(playerId, stat, gameDate);
      res.json(comparison);
    } catch (error) {
      apiLogger.error("Error comparing lines:", error);
      res.status(500).json({ error: "Failed to compare lines" });
    }
  });

  // Get line movements for a player
  app.get("/api/lines/movements/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const movements = await storage.getLineMovements(playerId, stat, gameDate);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching line movements:", error);
      res.status(500).json({ error: "Failed to fetch line movements" });
    }
  });

  // Get recent line movements (all players)
  app.get("/api/lines/movements/recent", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const movements = await storage.getRecentLineMovements(hours);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching recent movements:", error);
      res.status(500).json({ error: "Failed to fetch recent movements" });
    }
  });

  // Get best available lines
  app.get("/api/lines/best/:playerId", async (req, res) => {
    try {
      const playerId = parseInt(req.params.playerId);
      const stat = req.query.stat as string;

      if (isNaN(playerId) || !stat) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      const bestLines = await storage.getBestLines(playerId, stat);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines:", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  // Get best lines for a specific date
  app.get("/api/lines/best/date/:gameDate", async (req, res) => {
    try {
      const { gameDate } = req.params;
      const bestLines = await storage.getBestLinesForDate(gameDate);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines for date:", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  // Save a user bet
  app.post("/api/bets/user", async (req, res) => {
    try {
      const bet = req.body;
      const savedBet = await storage.saveUserBet(bet);
      res.json(savedBet);
    } catch (error) {
      apiLogger.error("Error saving user bet:", error);
      res.status(500).json({ error: "Failed to save bet" });
    }
  });

  // Get user bets
  app.get("/api/bets/user", async (req, res) => {
    try {
      const pending = req.query.pending === 'true';
      const gameDate = req.query.gameDate as string | undefined;

      const bets = await storage.getUserBets({ pending, gameDate });
      res.json(bets);
    } catch (error) {
      apiLogger.error("Error fetching user bets:", error);
      res.status(500).json({ error: "Failed to fetch user bets" });
    }
  });

  // Update user bet result
  app.patch("/api/bets/user/:betId", async (req, res) => {
    try {
      const betId = parseInt(req.params.betId);
      const { result, actualValue, profit } = req.body;

      if (isNaN(betId) || !result || actualValue === undefined || profit === undefined) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      await storage.updateUserBetResult(betId, result, actualValue, profit);
      res.json({ success: true });
    } catch (error) {
      apiLogger.error("Error updating bet result:", error);
      res.status(500).json({ error: "Failed to update bet result" });
    }
  });

  // =============== PARLAY ROUTES ===============

  // Create a parlay
  app.post("/api/parlays", async (req, res) => {
    try {
      const { parlayType, numPicks, entryAmount, payoutMultiplier, picks } = req.body;
      const savedParlay = await storage.saveParlay({
        parlayType,
        numPicks,
        entryAmount,
        payoutMultiplier,
        result: 'pending',
      }, picks);
      res.json(savedParlay);
    } catch (error) {
      apiLogger.error("Error saving parlay:", error);
      res.status(500).json({ error: "Failed to save parlay" });
    }
  });

  // Get user parlays
  app.get("/api/parlays", async (req, res) => {
    try {
      const pending = req.query.pending === 'true';
      const parlays = await storage.getParlays({ pending });
      res.json(parlays);
    } catch (error) {
      apiLogger.error("Error fetching parlays:", error);
      res.status(500).json({ error: "Failed to fetch parlays" });
    }
  });

  // Update parlay result
  app.patch("/api/parlays/:parlayId", async (req, res) => {
    try {
      const parlayId = parseInt(req.params.parlayId);
      const { result, profit } = req.body;
      const updatedParlay = await storage.updateParlayResult(parlayId, result, profit);
      res.json(updatedParlay);
    } catch (error) {
      apiLogger.error("Error updating parlay result:", error);
      res.status(500).json({ error: "Failed to update parlay result" });
    }
  });

  // Update parlay pick result
  app.patch("/api/parlays/:parlayId/picks/:pickId", async (req, res) => {
    try {
      const pickId = parseInt(req.params.pickId);
      const { result, actualValue } = req.body;
      const updatedPick = await storage.updateParlayPickResult(pickId, result, actualValue);
      res.json(updatedPick);
    } catch (error) {
      apiLogger.error("Error updating pick result:", error);
      res.status(500).json({ error: "Failed to update pick result" });
    }
  });

  // =============== SETTLEMENT ROUTES ===============

  // Manually trigger settlement (useful after reboot or for testing)
  app.post("/api/settle", async (_req, res) => {
    try {
      const { runSettlement } = await import("./services/auto-settle");
      const result = await runSettlement();
      res.json({
        success: true,
        settledPicks: result.settledPicks,
        settledParlays: result.settledParlays,
        message: `Settled ${result.settledPicks} picks across ${result.settledParlays} parlays`,
      });
    } catch (error) {
      apiLogger.error("Error running settlement:", error);
      res.status(500).json({ error: "Failed to run settlement" });
    }
  });

  // =============== ODDS API ROUTES ===============

  // Check if odds API is configured
  app.get("/api/odds/status", async (_req, res) => {
    try {
      const status = await getOddsApiStatus();
      res.json(status);
    } catch (error) {
      apiLogger.error("Error checking odds API status:", error);
      res.status(500).json({ error: "Failed to check odds API status" });
    }
  });

  // Get today's NBA games with odds availability
  app.get("/api/odds/events", async (_req, res) => {
    try {
      if (!isOddsApiConfigured()) {
        return res.status(503).json({
          error: "Odds API not configured",
          message: "Add THE_ODDS_API_KEY to your .env file"
        });
      }

      const events = await fetchNbaEvents();
      res.json(events);
    } catch (error) {
      apiLogger.error("Error fetching odds events:", error);
      res.status(500).json({ error: "Failed to fetch odds events" });
    }
  });

  // Get player props for a specific game/event
  app.get("/api/odds/events/:eventId/props", async (req, res) => {
    try {
      if (!isOddsApiConfigured()) {
        return res.status(503).json({
          error: "Odds API not configured",
          message: "Add THE_ODDS_API_KEY to your .env file"
        });
      }

      const { eventId } = req.params;
      if (!eventId) {
        return res.status(400).json({ error: "Event ID is required" });
      }

      const props = await fetchEventPlayerProps(eventId);
      if (!props) {
        return res.status(404).json({ error: "No props found for this event" });
      }


      res.json(props);
    } catch (error) {
      apiLogger.error("Error fetching event props:", error);
      res.status(500).json({ error: "Failed to fetch event props" });
    }
  });

  // =============== ADVANCED STATS ===============

  // Cache for advanced stats
  let advancedStatsCache: { data: any; timestamp: number } | null = null;

  app.get("/api/stats/advanced", async (req, res) => {
    try {
      // Check cache (4 hours)
      if (advancedStatsCache && Date.now() - advancedStatsCache.timestamp < 4 * 60 * 60 * 1000) {
        return res.json(advancedStatsCache.data);
      }

      apiLogger.info("Fetching advanced stats from Python...");
      const pythonProcess = spawn(getPythonCommand(), [
        "server/nba-prop-model/api.py",
        "--advanced-stats"
      ]);

      let dataString = "";
      let errorString = "";

      pythonProcess.on("error", (err) => {
        apiLogger.error("Failed to start Python process", err);
        res.status(500).json({ error: "Failed to start model process", details: err.message });
      });

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          apiLogger.error("Python script error:", errorString);
          return res.status(500).json({
            error: "Failed to fetch advanced stats",
            details: errorString || "Process exited with non-zero code",
            stdoutSnippet: dataString.slice(0, 500)
          });
        }

        try {
          const jsonData = JSON.parse(dataString);
          advancedStatsCache = { data: jsonData, timestamp: Date.now() };
          res.json(jsonData);
        } catch (e) {
          apiLogger.error("Failed to parse Python output:", e);
          res.status(500).json({
            error: "Invalid data format from analytics engine",
            details: (e as Error).message,
            contentPrefix: dataString.slice(0, 500)
          });
        }
      });
    } catch (error) {
      apiLogger.error("Error in /api/stats/advanced:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== PRIZEPICKS ROUTES ===============

  // Get scraper configuration status
  app.get("/api/prizepicks/scraper/status", async (_req, res) => {
    try {
      const status = getScraperStatus();
      res.json(status);
    } catch (error) {
      apiLogger.error("Error fetching scraper status:", error);
      res.status(500).json({ error: "Failed to fetch scraper status" });
    }
  });

  // Force rotate the scraper session (useful when blocked)
  app.post("/api/prizepicks/scraper/rotate", async (_req, res) => {
    try {
      const newSession = rotateScraperSession();
      res.json({
        success: true,
        message: "Scraper session rotated",
        newSession,
      });
    } catch (error) {
      apiLogger.error("Error rotating scraper session:", error);
      res.status(500).json({ error: "Failed to rotate scraper session" });
    }
  });

  // Add proxies to the scraper
  app.post("/api/prizepicks/scraper/proxies", async (req, res) => {
    try {
      const { proxies } = req.body;
      if (!proxies || !Array.isArray(proxies)) {
        return res.status(400).json({ error: "proxies array is required" });
      }
      addScraperProxies(proxies);
      res.json({
        success: true,
        message: `Added ${proxies.length} proxies`,
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error adding proxies:", error);
      res.status(500).json({ error: "Failed to add proxies" });
    }
  });

  // Reset failed proxies (give them another chance)
  app.post("/api/prizepicks/scraper/proxies/reset", async (_req, res) => {
    try {
      resetFailedProxies();
      res.json({
        success: true,
        message: "Reset all failed proxies",
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error resetting proxies:", error);
      res.status(500).json({ error: "Failed to reset proxies" });
    }
  });

  // Reset scraper statistics
  app.post("/api/prizepicks/scraper/stats/reset", async (_req, res) => {
    try {
      resetScraperStats();
      res.json({
        success: true,
        message: "Reset scraper statistics",
        status: getScraperStatus(),
      });
    } catch (error) {
      apiLogger.error("Error resetting stats:", error);
      res.status(500).json({ error: "Failed to reset stats" });
    }
  });

  // Get all NBA PrizePicks projections
  app.get("/api/prizepicks/projections", async (_req, res) => {
    try {
      const projections = await fetchPrizePicksProjections();
      res.json(projections);
    } catch (error) {
      apiLogger.error("Error fetching PrizePicks projections:", error);
      res.status(500).json({
        error: "Failed to fetch PrizePicks projections",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get PrizePicks props for a specific player
  app.get("/api/prizepicks/player/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      const props = await fetchPlayerPrizePicksProps(decodeURIComponent(playerName));
      res.json(props);
    } catch (error) {
      apiLogger.error("Error fetching player PrizePicks props:", error);
      res.status(500).json({ error: "Failed to fetch player props" });
    }
  });

  // =============== PRIZEPICKS LINE TRACKING ROUTES ===============

  // Get PrizePicks line tracker status
  app.get("/api/prizepicks/tracker/status", async (_req, res) => {
    try {
      const stats = prizePicksLineTracker.getStats();
      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching PrizePicks tracker status:", error);
      res.status(500).json({ error: "Failed to fetch tracker status" });
    }
  });

  // Start PrizePicks line tracking
  app.post("/api/prizepicks/tracker/start", async (req, res) => {
    try {
      const intervalMs = parseInt(req.query.interval as string) || 300000; // Default 5 minutes
      prizePicksLineTracker.setStorage(prizePicksStorage);
      prizePicksLineTracker.start(intervalMs);
      res.json({
        success: true,
        message: `PrizePicks line tracker started with ${intervalMs / 1000}s interval`,
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error starting PrizePicks tracker:", error);
      res.status(500).json({ error: "Failed to start tracker" });
    }
  });

  // Stop PrizePicks line tracking
  app.post("/api/prizepicks/tracker/stop", async (_req, res) => {
    try {
      prizePicksLineTracker.stop();
      res.json({
        success: true,
        message: "PrizePicks line tracker stopped",
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error stopping PrizePicks tracker:", error);
      res.status(500).json({ error: "Failed to stop tracker" });
    }
  });

  // Force a poll of PrizePicks lines
  app.post("/api/prizepicks/tracker/poll", async (_req, res) => {
    try {
      // Ensure storage is connected
      prizePicksLineTracker.setStorage(prizePicksStorage);
      await prizePicksLineTracker.pollNow();
      res.json({
        success: true,
        message: "Poll completed",
        stats: prizePicksLineTracker.getStats(),
      });
    } catch (error) {
      apiLogger.error("Error polling PrizePicks lines:", error);
      res.status(500).json({ error: "Failed to poll lines" });
    }
  });

  // Get current in-memory lines (fast, no DB)
  app.get("/api/prizepicks/lines/current", async (_req, res) => {
    try {
      const lines = prizePicksLineTracker.getCurrentLines();
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching current lines:", error);
      res.status(500).json({ error: "Failed to fetch current lines" });
    }
  });

  // Get historical lines for a player
  app.get("/api/prizepicks/lines/player/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      const lines = await prizePicksStorage.getPrizePicksLinesByPlayer(
        decodeURIComponent(playerName)
      );
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching player line history:", error);
      res.status(500).json({ error: "Failed to fetch player line history" });
    }
  });

  // Get line history for a specific player/stat/game
  app.get("/api/prizepicks/lines/history", async (req, res) => {
    try {
      const { playerId, statType, gameTime } = req.query;

      if (!playerId || !statType || !gameTime) {
        return res.status(400).json({
          error: "Missing required parameters: playerId, statType, gameTime",
        });
      }

      const history = await prizePicksStorage.getPrizePicksLineHistory(
        playerId as string,
        statType as string,
        new Date(gameTime as string)
      );

      res.json(history);
    } catch (error) {
      apiLogger.error("Error fetching line history:", error);
      res.status(500).json({ error: "Failed to fetch line history" });
    }
  });

  // Get recent line movements
  app.get("/api/prizepicks/movements", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const movements = await prizePicksStorage.getRecentPrizePicksMovements(limit);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching line movements:", error);
      res.status(500).json({ error: "Failed to fetch line movements" });
    }
  });

  // Get significant movements (alerts)
  app.get("/api/prizepicks/movements/significant", async (req, res) => {
    try {
      const hours = parseInt(req.query.hours as string) || 24;
      const movements = await prizePicksStorage.getSignificantMovements(hours);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching significant movements:", error);
      res.status(500).json({ error: "Failed to fetch significant movements" });
    }
  });

  // Get daily line summary for a date
  app.get("/api/prizepicks/daily", async (req, res) => {
    try {
      const dateStr = req.query.date as string;
      const date = dateStr ? new Date(dateStr) : new Date();

      const dailyLines = await prizePicksStorage.getPrizePicksDailyLines(date);
      res.json(dailyLines);
    } catch (error) {
      apiLogger.error("Error fetching daily lines:", error);
      res.status(500).json({ error: "Failed to fetch daily lines" });
    }
  });

  // Get player line trend over time
  app.get("/api/prizepicks/trend/:playerName/:statType", async (req, res) => {
    try {
      const { playerName, statType } = req.params;
      const days = parseInt(req.query.days as string) || 30;

      if (!playerName || !statType) {
        return res.status(400).json({ error: "Player name and stat type are required" });
      }

      const trend = await prizePicksStorage.getPlayerLineTrend(
        decodeURIComponent(playerName),
        decodeURIComponent(statType),
        days
      );

      res.json(trend);
    } catch (error) {
      apiLogger.error("Error fetching player line trend:", error);
      res.status(500).json({ error: "Failed to fetch line trend" });
    }
  });

  // Get all current lines from database (with full history available)
  app.get("/api/prizepicks/lines/all", async (_req, res) => {
    try {
      const lines = await prizePicksStorage.getCurrentPrizePicksLines();
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching all current lines:", error);
      res.status(500).json({ error: "Failed to fetch all current lines" });
    }
  });

  // =============== INJURY TRACKING ROUTES ===============

  // Get injury watcher status
  app.get("/api/injuries/status", async (_req, res) => {
    try {
      res.json({
        isActive: injuryWatcher.isActive(),
        lastCheck: injuryWatcher.getLastCheckTime(),
        knownInjuries: injuryWatcher.getKnownInjuries().length,
      });
    } catch (error) {
      apiLogger.error("Error fetching injury status:", error);
      res.status(500).json({ error: "Failed to fetch injury status" });
    }
  });

  // Start injury monitoring
  app.post("/api/injuries/start", async (req, res) => {
    try {
      const intervalMs = parseInt(req.query.interval as string) || 60000;
      await injuryWatcher.start(intervalMs);
      res.json({
        success: true,
        message: `Injury watcher started with ${intervalMs}ms interval`,
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error starting injury watcher:", error);
      res.status(500).json({ error: "Failed to start injury watcher" });
    }
  });

  // Stop injury monitoring
  app.post("/api/injuries/stop", async (_req, res) => {
    try {
      injuryWatcher.stop();
      res.json({
        success: true,
        message: "Injury watcher stopped",
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error stopping injury watcher:", error);
      res.status(500).json({ error: "Failed to stop injury watcher" });
    }
  });

  // Force check for injury updates
  app.post("/api/injuries/check", async (_req, res) => {
    try {
      const changes = await injuryWatcher.forceCheck();
      res.json({
        success: true,
        changes,
        changesCount: changes.length,
        lastCheck: injuryWatcher.getLastCheckTime(),
      });
    } catch (error) {
      apiLogger.error("Error checking injuries:", error);
      res.status(500).json({ error: "Failed to check injuries" });
    }
  });

  // Get all current injuries for teams playing today
  app.get("/api/injuries/today", async (_req, res) => {
    try {
      const injuries = await fetchTodaysGameInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching today's injuries:", error);
      res.status(500).json({ error: "Failed to fetch today's injuries" });
    }
  });

  // Get all NBA injuries (league-wide)
  app.get("/api/injuries/all", async (_req, res) => {
    try {
      const injuries = await fetchAllNbaInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching all injuries:", error);
      res.status(500).json({ error: "Failed to fetch all injuries" });
    }
  });

  // Get injuries for a specific team
  app.get("/api/injuries/team/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      // Try to get from watcher first (if active), otherwise fetch fresh
      let injuries: PlayerInjuryReport[] = [];
      if (injuryWatcher.isActive()) {
        const watcherInjuries = injuryWatcher.getTeamInjuries(teamAbbr.toUpperCase());
        injuries = watcherInjuries.map(inj => ({
          playerId: inj.playerId,
          playerName: inj.playerName,
          team: inj.team,
          teamId: 0,
          status: inj.status,
          injuryType: inj.injuryType,
          description: inj.description,
          source: 'espn' as const,
        }));
      } else {
        const allInjuries = await fetchTodaysGameInjuries();
        injuries = allInjuries.filter(inj => inj.team === teamAbbr.toUpperCase());
      }

      res.json({
        team: teamAbbr.toUpperCase(),
        injuries,
        count: injuries.length,
        outPlayers: injuries.filter(i => i.status === 'out').map(i => i.playerName),
      });
    } catch (error) {
      apiLogger.error("Error fetching team injuries:", error);
      res.status(500).json({ error: "Failed to fetch team injuries" });
    }
  });

  // Get players who are OUT for a team (useful for projection adjustments)
  app.get("/api/injuries/out/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const outPlayers = await getTeamOutPlayers(teamAbbr.toUpperCase());
      res.json({
        team: teamAbbr.toUpperCase(),
        outPlayers,
        count: outPlayers.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching out players:", error);
      res.status(500).json({ error: "Failed to fetch out players" });
    }
  });

  // Get injury-adjusted projection for a player
  app.get("/api/injuries/projection/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      const team = req.query.team as string;

      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      // Get injured teammates
      const outPlayers = team ? await getTeamOutPlayers(team.toUpperCase()) : [];

      // Get baseline projection (without injuries)
      const baseline = await calculateInjuryAdjustedProjection(
        decodeURIComponent(playerName),
        []
      );

      // Get adjusted projection (with injuries)
      const adjusted = await calculateInjuryAdjustedProjection(
        decodeURIComponent(playerName),
        outPlayers
      );

      if (!baseline && !adjusted) {
        return res.status(404).json({ error: "Could not generate projections" });
      }

      res.json({
        playerName: decodeURIComponent(playerName),
        team: team?.toUpperCase(),
        injuredTeammates: outPlayers,
        baseline: baseline?.projection,
        adjusted: adjusted?.projection,
        hasInjuryImpact: outPlayers.length > 0,
        context: adjusted?.context || baseline?.context,
      });
    } catch (error) {
      apiLogger.error("Error fetching injury-adjusted projection:", error);
      res.status(500).json({ error: "Failed to fetch projection" });
    }
  });

  // Get injury edge impact for a specific player prop
  app.get("/api/injuries/edge/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      const team = req.query.team as string;
      const stat = req.query.stat as string;
      const line = parseFloat(req.query.line as string);

      if (!playerName || !team || !stat || isNaN(line)) {
        return res.status(400).json({
          error: "Missing required parameters",
          required: ["playerName", "team", "stat", "line"],
        });
      }

      const impact = await calculateInjuryEdgeChange(
        decodeURIComponent(playerName),
        team.toUpperCase(),
        stat,
        line
      );

      if (!impact) {
        return res.status(404).json({ error: "Could not calculate injury impact" });
      }

      res.json({
        playerName: decodeURIComponent(playerName),
        team: team.toUpperCase(),
        stat,
        line,
        ...impact,
        recommendation: impact.isOpportunity
          ? impact.edgeChange > 0
            ? "OVER opportunity due to teammate injuries"
            : "UNDER opportunity due to teammate injuries"
          : "No significant edge change from injuries",
      });
    } catch (error) {
      apiLogger.error("Error calculating injury edge:", error);
      res.status(500).json({ error: "Failed to calculate injury edge" });
    }
  });

  // Get all injury-affected opportunities (players with significant edge changes)
  app.get("/api/injuries/opportunities", async (req, res) => {
    try {
      const minEdgeChange = parseFloat(req.query.minEdge as string) || 0.05;

      // Get today's injuries
      const injuries = await fetchTodaysGameInjuries();
      const outByTeam = new Map<string, string[]>();

      // Group OUT players by team
      for (const inj of injuries) {
        if (inj.status === 'out') {
          const teamOuts = outByTeam.get(inj.team) || [];
          teamOuts.push(inj.playerName);
          outByTeam.set(inj.team, teamOuts);
        }
      }

      // Return teams with OUT players and their impact summary
      const opportunities = Array.from(outByTeam.entries()).map(([team, outPlayers]) => ({
        team,
        outPlayers,
        outCount: outPlayers.length,
        impactLevel: outPlayers.length >= 2 ? 'high' : outPlayers.length === 1 ? 'medium' : 'low',
        recommendation: `Check projections for ${team} players - ${outPlayers.length} key player(s) out`,
      }));

      res.json({
        opportunities: opportunities.filter(o => o.outCount > 0),
        teamsAffected: opportunities.length,
        totalPlayersOut: injuries.filter(i => i.status === 'out').length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching injury opportunities:", error);
      res.status(500).json({ error: "Failed to fetch injury opportunities" });
    }
  });

  // Get injury alerts with betting impact for dashboard widget
  app.get("/api/injuries/alerts", async (_req, res) => {
    try {
      // Get all current injuries from injury watcher
      const allInjuries = injuryWatcher.getKnownInjuries();
      const significantInjuries = allInjuries.filter(
        inj => inj.status === 'out' || inj.status === 'doubtful'
      );

      // Group by team
      const byTeam: Record<string, typeof significantInjuries> = {};
      for (const inj of significantInjuries) {
        if (!byTeam[inj.team]) byTeam[inj.team] = [];
        byTeam[inj.team].push(inj);
      }

      const getOutCount = (injuries: typeof significantInjuries) =>
        injuries.filter(i => i.status === 'out').length;

      const getImpactLevel = (injuries: typeof significantInjuries): 'high' | 'medium' | 'low' => {
        const outs = getOutCount(injuries);
        if (outs >= 2) return 'high';
        if (outs === 1) return 'medium';
        return 'low';
      };

      const alerts = Object.entries(byTeam).map(([team, injuries]) => ({
        team,
        injuries: injuries.map(inj => ({
          playerName: inj.playerName,
          status: inj.status,
          description: inj.description || inj.injuryType || 'Injury',
        })),
        beneficiaries: [] as Array<{ playerName: string; stat: string; impact: number; recommendation: string }>,
        impactLevel: getImpactLevel(injuries),
      }));

      // Sort: high impact first, then by number of out injuries
      const sortedAlerts = alerts.sort((a, b) => {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        const diff =
          impactOrder[b.impactLevel as keyof typeof impactOrder] -
          impactOrder[a.impactLevel as keyof typeof impactOrder];
        if (diff !== 0) return diff;
        return getOutCount(byTeam[b.team]) - getOutCount(byTeam[a.team]);
      });

      const outInjuries = allInjuries.filter(inj => inj.status === 'out');

      res.json({
        alerts: sortedAlerts,
        totalInjuries: outInjuries.length,
        teamsAffected: Object.keys(byTeam).length,
        highImpactAlerts: sortedAlerts.filter(a => a.impactLevel === 'high').length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching injury alerts:", error);
      res.status(500).json({ error: "Failed to fetch injury alerts" });
    }
  });

  // Projection with injury context (POST version for more flexibility)
  app.post("/api/projections/with-injuries", async (req, res) => {
    try {
      const { players, injuries } = req.body;

      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");

      // Build args with injury context
      const args = ["--players", ...players];
      if (injuries && Array.isArray(injuries) && injuries.length > 0) {
        args.push("--injuries", ...injuries);
      }

      apiLogger.info(`Running python script with injuries: ${args.join(' ')}`);

      const pythonProcess = spawn(getPythonCommand(), [scriptPath, ...args]);

      let dataString = "";
      let errorString = "";

      pythonProcess.on("error", (err) => {
        apiLogger.error("Failed to start Python process", err);
        res.status(500).json({ error: "Failed to start model process", details: err.message });
      });

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          apiLogger.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          res.json({
            ...json,
            injuryContext: {
              injuredPlayers: injuries || [],
              injuryCount: (injuries || []).length,
            }
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output. Data:", dataString);
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating injury-adjusted projections:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== ON/OFF SPLITS ROUTES ===============

  // Get all teammates' stat changes when a player sits
  app.get("/api/splits/without-player/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { season } = req.query;

      if (!playerId) {
        return res.status(400).json({ error: "Player ID is required" });
      }

      let splits = await onOffService.getSplitsForPlayer(
        parseInt(playerId),
        season as string | undefined
      );

      // Auto-calculate if no data found
      if (splits.length === 0) {
        const player = await storage.getPlayer(parseInt(playerId));
        const playerName = player?.player_name || req.query.playerName as string;
        const team = player?.team || req.query.team as string;

        if (playerName && team) {
          // Try Python calculator first
          try {
            apiLogger.info(`No splits found for ${playerName}. Auto-calculating via Python...`);
            await onOffService.calculateSplitsForPlayer(
              parseInt(playerId),
              playerName,
              team
            );
            splits = await onOffService.getSplitsForPlayer(
              parseInt(playerId),
              season as string | undefined
            );
          } catch (calcError) {
            apiLogger.warn("Python auto-calculation failed, trying game-log fallback:", calcError);
          }

          // Fallback: compute from game log data already in DB
          if (splits.length === 0) {
            try {
              apiLogger.info(`Computing fallback splits from game logs for ${playerName}...`);
              splits = await onOffService.computeSplitsFromGameLogs(
                parseInt(playerId),
                playerName,
                team
              );
            } catch (fallbackError) {
              apiLogger.error("Game-log fallback calculation also failed:", fallbackError);
            }
          }
        } else {
          apiLogger.info(`Cannot auto-calculate splits: Player ${playerId} not in DB and no playerName/team provided in query`);
        }
      }

      // Filter out entries with insufficient sample size (at least 2 games without)
      const validSplits = splits.filter(s => s.gamesWithoutTeammate >= 2);

      // Sort by points delta descending (biggest beneficiaries first)
      const sortedSplits = validSplits.sort((a, b) => {
        const aDelta = a.ptsDelta ?? 0;
        const bDelta = b.ptsDelta ?? 0;
        return bDelta - aDelta;
      });

      res.json({
        playerId: parseInt(playerId),
        splits: sortedSplits,
        count: sortedSplits.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching on/off splits:", error);
      res.status(500).json({ error: "Failed to fetch on/off splits" });
    }
  });

  // Get top beneficiaries by stat
  app.get("/api/splits/biggest-beneficiaries/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { stat = 'pts', limit = '5' } = req.query;

      if (!playerId) {
        return res.status(400).json({ error: "Player ID is required" });
      }

      if (!['pts', 'reb', 'ast'].includes(stat as string)) {
        return res.status(400).json({ error: "Stat must be pts, reb, or ast" });
      }

      const beneficiaries = await onOffService.getTopBeneficiaries(
        parseInt(playerId),
        stat as 'pts' | 'reb' | 'ast',
        parseInt(limit as string)
      );

      res.json({
        playerId: parseInt(playerId),
        stat,
        beneficiaries,
        count: beneficiaries.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching top beneficiaries:", error);
      res.status(500).json({ error: "Failed to fetch top beneficiaries" });
    }
  });

  // Manually trigger calculation for a player
  app.post("/api/splits/calculate/:playerId", async (req, res) => {
    try {
      const { playerId } = req.params;
      const { playerName, team, seasons } = req.body;

      if (!playerId || !playerName || !team) {
        return res.status(400).json({
          error: "Player ID, player name, and team are required",
        });
      }

      // Start calculation in background
      onOffService.calculateSplitsForPlayer(
        parseInt(playerId),
        playerName,
        team,
        seasons
      ).catch(error => {
        apiLogger.error("Background calculation failed:", error);
      });

      res.json({
        message: "Calculation started",
        playerId: parseInt(playerId),
        playerName,
        status: "processing",
      });
    } catch (error) {
      apiLogger.error("Error triggering calculation:", error);
      res.status(500).json({ error: "Failed to start calculation" });
    }
  });

  // Get team-wide splits
  app.get("/api/splits/team/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      const { season } = req.query;

      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const splits = await onOffService.getTeamSplits(
        teamAbbr.toUpperCase(),
        season as string | undefined
      );

      // Group by injured player
      const groupedByInjuredPlayer = splits.reduce((acc, split) => {
        const key = split.withoutPlayerId;
        if (!acc[key]) {
          acc[key] = {
            injuredPlayerId: split.withoutPlayerId,
            injuredPlayerName: split.withoutPlayerName,
            teammates: [],
          };
        }
        acc[key].teammates.push(split);
        return acc;
      }, {} as Record<number, {
        injuredPlayerId: number;
        injuredPlayerName: string;
        teammates: typeof splits;
      }>);

      res.json({
        teamAbbr: teamAbbr.toUpperCase(),
        season,
        injuredPlayers: Object.values(groupedByInjuredPlayer),
        totalSplits: splits.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching team splits:", error);
      res.status(500).json({ error: "Failed to fetch team splits" });
    }
  });

  // =============== TEAM STATS ROUTES ===============

  // Get all NBA teams list
  app.get("/api/teams", async (_req, res) => {
    try {
      const teams = getAllTeamsInfo();
      res.json(teams);
    } catch (error) {
      apiLogger.error("Error fetching teams:", error);
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

  // Get complete team stats by abbreviation
  app.get("/api/teams/:teamAbbr/stats", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const stats = await fetchTeamStats(teamAbbr.toUpperCase());
      if (!stats) {
        return res.status(404).json({ error: "Team not found or no data available" });
      }

      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching team stats:", error);
      res.status(500).json({ error: "Failed to fetch team stats" });
    }
  });

  // Get team recent games with quarter breakdown
  app.get("/api/teams/:teamAbbr/games", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      const limit = parseInt(req.query.limit as string) || 15;

      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), limit);
      res.json({
        team: teamAbbr.toUpperCase(),
        games,
        count: games.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching team games:", error);
      res.status(500).json({ error: "Failed to fetch team games" });
    }
  });

  // Get team rotation stats (minutes by game type)
  app.get("/api/teams/:teamAbbr/rotation", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      // Get recent games first for context
      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), 15);
      const rotation = await fetchTeamRotation(teamAbbr.toUpperCase(), games);

      // Calculate summary stats
      const closeGames = games.filter(g => g.gameType === 'close_win' || g.gameType === 'close_loss');
      const blowouts = games.filter(g => g.gameType === 'blowout_win' || g.gameType === 'blowout_loss');

      res.json({
        team: teamAbbr.toUpperCase(),
        rotation,
        summary: {
          totalGames: games.length,
          closeGames: closeGames.length,
          blowouts: blowouts.length,
          closeGamePct: games.length > 0 ? closeGames.length / games.length : 0,
        },
      });
    } catch (error) {
      apiLogger.error("Error fetching team rotation:", error);
      res.status(500).json({ error: "Failed to fetch team rotation" });
    }
  });

  // Compare two teams
  app.get("/api/teams/compare/:team1/:team2", async (req, res) => {
    try {
      const { team1, team2 } = req.params;
      if (!team1 || !team2) {
        return res.status(400).json({ error: "Both team abbreviations are required" });
      }

      const comparison = await compareTeams(team1.toUpperCase(), team2.toUpperCase());
      if (!comparison) {
        return res.status(404).json({ error: "Could not compare teams - one or both not found" });
      }

      res.json(comparison);
    } catch (error) {
      apiLogger.error("Error comparing teams:", error);
      res.status(500).json({ error: "Failed to compare teams" });
    }
  });

  // Get team quarter scoring averages
  app.get("/api/teams/:teamAbbr/scoring", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

      const games = await fetchTeamRecentGames(teamAbbr.toUpperCase(), 15);

      if (games.length === 0) {
        return res.status(404).json({ error: "No games found for team" });
      }

      // Calculate scoring averages
      const avgScoring = {
        q1: games.reduce((s, g) => s + g.quarterScoring.q1, 0) / games.length,
        q2: games.reduce((s, g) => s + g.quarterScoring.q2, 0) / games.length,
        q3: games.reduce((s, g) => s + g.quarterScoring.q3, 0) / games.length,
        q4: games.reduce((s, g) => s + g.quarterScoring.q4, 0) / games.length,
        firstHalf: games.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / games.length,
        secondHalf: games.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / games.length,
      };

      // Home vs Away
      const homeGames = games.filter(g => g.isHome);
      const awayGames = games.filter(g => !g.isHome);

      const homeAvg = homeGames.length > 0 ? {
        q1: homeGames.reduce((s, g) => s + g.quarterScoring.q1, 0) / homeGames.length,
        q2: homeGames.reduce((s, g) => s + g.quarterScoring.q2, 0) / homeGames.length,
        q3: homeGames.reduce((s, g) => s + g.quarterScoring.q3, 0) / homeGames.length,
        q4: homeGames.reduce((s, g) => s + g.quarterScoring.q4, 0) / homeGames.length,
        firstHalf: homeGames.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / homeGames.length,
        secondHalf: homeGames.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / homeGames.length,
      } : null;

      const awayAvg = awayGames.length > 0 ? {
        q1: awayGames.reduce((s, g) => s + g.quarterScoring.q1, 0) / awayGames.length,
        q2: awayGames.reduce((s, g) => s + g.quarterScoring.q2, 0) / awayGames.length,
        q3: awayGames.reduce((s, g) => s + g.quarterScoring.q3, 0) / awayGames.length,
        q4: awayGames.reduce((s, g) => s + g.quarterScoring.q4, 0) / awayGames.length,
        firstHalf: awayGames.reduce((s, g) => s + g.quarterScoring.firstHalf, 0) / awayGames.length,
        secondHalf: awayGames.reduce((s, g) => s + g.quarterScoring.secondHalf, 0) / awayGames.length,
      } : null;

      res.json({
        team: teamAbbr.toUpperCase(),
        gamesAnalyzed: games.length,
        overall: avgScoring,
        home: homeAvg,
        away: awayAvg,
        byGame: games.map(g => ({
          date: g.date,
          opponent: g.opponent,
          isHome: g.isHome,
          result: g.result,
          ...g.quarterScoring,
        })),
      });
    } catch (error) {
      apiLogger.error("Error fetching team scoring:", error);
      res.status(500).json({ error: "Failed to fetch team scoring" });
    }
  });

  // =============== BACKTEST INFRASTRUCTURE ROUTES ===============

  // Get signal performance summary (latest accuracy data per signal)
  app.get("/api/backtest/signals", async (req, res) => {
    try {
      const statType = (req.query.statType as string) || "Points";
      const days = parseInt(req.query.days as string) || 30;

      if (!pool) {
        return res.json({ signals: [], statType, days, message: "Database not configured" });
      }

      const result = await pool.query(`
        SELECT
          signal_name,
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
        GROUP BY signal_name, stat_type
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

      // Data is stale if: there are pending actuals OR validation hasn't run recently
      const today = new Date().toISOString().split('T')[0];
      const validationStale = !lastValidationDate || lastValidationDate < today;

      const stats = projStats.rows[0];
      const total = parseInt(stats.total) || 0;
      const completed = parseInt(stats.completed) || 0;
      const hits = parseInt(stats.hits) || 0;

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
          needsRefresh: pendingActuals > 0 || validationStale,
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

      // Step 1: Populate actuals for yesterday's games
      apiLogger.info("[Backtest Refresh] Running actuals population...");
      const actualsResult = await runPythonScript("actuals");

      // Step 2: Run validation
      apiLogger.info("[Backtest Refresh] Running validation...");
      const validationResult = await runPythonScript("validate");

      const duration = Date.now() - startTime;
      lastRefreshTime = new Date();
      lastRefreshResult = {
        actuals: {
          success: actualsResult.success,
          message: actualsResult.output.trim() || (actualsResult.success ? "Completed" : actualsResult.error),
        },
        validation: {
          success: validationResult.success,
          message: validationResult.output.trim() || (validationResult.success ? "Completed" : validationResult.error),
        },
        duration: `${(duration / 1000).toFixed(1)}s`,
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

  // Register ref foul signal routes
  apiLogger.info("DEBUG: About to register Ref Signal Routes in routes.ts");
  registerRefSignalRoutes(app);

  // -------------------------------------------------------------------------
  // Signal Engine API Endpoints
  // -------------------------------------------------------------------------

  // Helper: run a Python script and return parsed JSON output
  async function runPythonScript(
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
        cwd: path.join(__dirname, "nba-prop-model"),
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
  const signalCache: Map<string, { data: any; fetchedAt: number }> = new Map();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  function getCached(key: string) {
    const entry = signalCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
      signalCache.delete(key);
      return null;
    }
    return entry;
  }

  function setCached(key: string, data: any) {
    signalCache.set(key, { data, fetchedAt: Date.now() });
  }

  // GET /api/projections/today — All projections for today, sorted by edge_pct DESC
  app.get("/api/projections/today", async (req, res) => {
    try {
      const gameDate =
        (req.query.date as string) ||
        new Date().toISOString().split("T")[0];

      const cacheKey = `projections_today_${gameDate}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({
          projections: cached.data,
          cached: true,
          cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000),
        });
      }

      const result = await pool.query(
        `SELECT po.*, p.player_name
         FROM projection_outputs po
         LEFT JOIN players p ON po.player_id = p.id
         WHERE po.game_date = $1
         ORDER BY ABS(po.edge_pct) DESC`,
        [gameDate]
      );

      const projections = result.rows.map((row) => ({
        ...row,
        signals_fired:
          typeof row.signals_fired === "string"
            ? JSON.parse(row.signals_fired)
            : row.signals_fired,
      }));

      setCached(cacheKey, projections);
      res.json({ projections, cached: false });
    } catch (error: any) {
      apiLogger.error("[Projections Today] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/projections/:id — Single projection with signals breakdown
  app.get("/api/projections/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT po.*, p.player_name
         FROM projection_outputs po
         LEFT JOIN players p ON po.player_id = p.id
         WHERE po.id = $1`,
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Projection not found" });
      }
      const row = result.rows[0];
      res.json({
        ...row,
        signals_fired:
          typeof row.signals_fired === "string"
            ? JSON.parse(row.signals_fired)
            : row.signals_fired,
      });
    } catch (error: any) {
      apiLogger.error("[Projection Detail] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/signals/history?days=30 — Signal hit rates by type
  app.get("/api/signals/history", async (req, res) => {
    try {
      const days = parseInt((req.query.days as string) || "30", 10);
      const cacheKey = `signals_history_${days}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
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

      const targetDate = game_date || new Date().toISOString().split("T")[0];

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
sys.path.insert(0, '${path.join(__dirname, "nba-prop-model")}')
os.chdir('${path.join(__dirname, "nba-prop-model")}')
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
          cwd: path.join(__dirname, "nba-prop-model"),
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
  app.get("/api/backtest", async (req, res) => {
    try {
      const signal = (req.query.signal as string) || null;
      const days = parseInt((req.query.days as string) || "90", 10);

      const cacheKey = `backtest_${signal}_${days}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return res.json({ ...cached.data, cached: true, cache_age: Math.floor((Date.now() - cached.fetchedAt) / 1000) });
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
          row.cumulative_units = parseFloat(cumUnits.toFixed(2));
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
   * GET /api/parlays?date=YYYY-MM-DD&size=2&min_ev=0.05&limit=20
   * Returns top correlated parlay recommendations from parlay_results.
   */
  app.get("/api/parlays", async (req, res) => {
    try {
      const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
      const size = parseInt((req.query.size as string) || "0", 10) || null;
      const minEv = parseFloat((req.query.min_ev as string) || "0");
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);

      let query = `
        SELECT
          id, legs, correlations, parlay_type, parlay_template,
          leg_count, base_hit_prob, true_hit_prob, payout,
          combined_ev, recommendation, avoid_reason,
          outcome, payout_received, game_date, created_at
        FROM parlay_results
        WHERE game_date = $1
          AND combined_ev >= $2
      `;
      const params: any[] = [date, minEv];

      if (size) {
        params.push(size);
        query += ` AND leg_count = $${params.length}`;
      }

      query += ` ORDER BY combined_ev DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await pool.query(query, params);
      res.json({ date, parlays: result.rows, count: result.rows.length });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching parlays:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/parlays/correlations?player_a=X&player_b=Y&stat=pts
   * Look up a specific pairwise correlation from the cache.
   */
  app.get("/api/parlays/correlations", async (req, res) => {
    try {
      const { player_a, player_b, stat } = req.query as Record<string, string>;
      if (!player_a || !player_b) {
        return res.status(400).json({ error: "player_a and player_b are required" });
      }
      const statType = stat || "pts";

      const result = await pool.query(
        `SELECT *
         FROM player_correlations
         WHERE (
           (player_a_id = $1 AND player_b_id = $2)
           OR (player_a_id = $2 AND player_b_id = $1)
         )
         AND stat_type = $3
         LIMIT 1`,
        [player_a, player_b, statType]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Correlation not found in cache" });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching correlation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/parlays/team-matrix?team_id=X&stat=pts
   * Return all cached pairwise correlations for a team's rotation.
   */
  app.get("/api/parlays/team-matrix", async (req, res) => {
    try {
      const { team_id, stat } = req.query as Record<string, string>;
      if (!team_id) {
        return res.status(400).json({ error: "team_id is required" });
      }
      const statType = stat || "pts";

      const result = await pool.query(
        `SELECT
           pc.player_a_id, pc.player_b_id, pc.correlation,
           pc.relationship, pc.confidence, pc.sample_size,
           pc.same_team, pc.updated_at
         FROM player_correlations pc
         WHERE pc.stat_type = $1
           AND pc.same_team = true
           AND pc.confidence IN ('HIGH', 'MEDIUM')
           AND (
             pc.player_a_id IN (
               SELECT DISTINCT CAST(player_id AS VARCHAR)
               FROM player_game_stats
               WHERE team_id = $2
                 AND game_date >= NOW() - INTERVAL '60 days'
             )
             OR pc.player_b_id IN (
               SELECT DISTINCT CAST(player_id AS VARCHAR)
               FROM player_game_stats
               WHERE team_id = $2
                 AND game_date >= NOW() - INTERVAL '60 days'
             )
           )
         ORDER BY ABS(pc.correlation) DESC`,
        [statType, team_id]
      );

      res.json({ team_id, stat: statType, correlations: result.rows });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error fetching team matrix:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/parlays/generate
   * Trigger the parlay builder Python script for a given date.
   * Body: { date?: string, parlay_size?: number }
   */
  app.post("/api/parlays/generate", async (req, res) => {
    try {
      const { date, parlay_size } = req.body as {
        date?: string;
        parlay_size?: number;
      };
      const targetDate = date || new Date().toISOString().slice(0, 10);
      const size = parlay_size || 2;

      const pythonCmd = getPythonCommand();
      const scriptPath = path.join(
        process.cwd(),
        "server",
        "nba-prop-model",
        "scripts",
        "cron_jobs.py"
      );

      const child = spawn(pythonCmd, [
        scriptPath,
        "parlays",
        "--date",
        targetDate,
      ]);

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.on("close", async (code: number) => {
        if (code !== 0) {
          apiLogger.error(`[Parlays] generate script exited ${code}: ${stderr}`);
          return res.status(500).json({
            error: "Parlay generation failed",
            stderr: stderr.slice(0, 500),
          });
        }

        // Return the freshly generated parlays
        const result = await pool.query(
          `SELECT id, legs, correlations, parlay_type, parlay_template,
                  leg_count, base_hit_prob, true_hit_prob, payout,
                  combined_ev, recommendation, avoid_reason, game_date
           FROM parlay_results
           WHERE game_date = $1
             AND leg_count = $2
           ORDER BY combined_ev DESC
           LIMIT 20`,
          [targetDate, size]
        );

        res.json({
          date: targetDate,
          parlay_size: size,
          parlays: result.rows,
          count: result.rows.length,
          stdout: stdout.trim(),
        });
      });
    } catch (error: any) {
      apiLogger.error("[Parlays] Error triggering generation:", error);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * PATCH /api/parlays/:id/outcome
   * Settle a parlay once games complete.
   * Body: { outcome: boolean, payout_received?: number }
   */
  app.patch("/api/parlays/:id/outcome", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { outcome, payout_received } = req.body as {
        outcome: boolean;
        payout_received?: number;
      };

      if (typeof outcome !== "boolean") {
        return res.status(400).json({ error: "outcome must be a boolean" });
      }

      const result = await pool.query(
        `UPDATE parlay_results
         SET outcome = $1, payout_received = $2
         WHERE id = $3
         RETURNING *`,
        [outcome, payout_received ?? null, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Parlay not found" });
      }
      res.json(result.rows[0]);
    } catch (error: any) {
      apiLogger.error("[Parlays] Error settling parlay:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}

