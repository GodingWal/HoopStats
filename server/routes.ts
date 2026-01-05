import type { Express } from "express";
import { createServer, type Server } from "http";
import { spawn } from "child_process";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

import { storage } from "./storage";
import type { Player } from "@shared/schema";
import { fetchAndBuildAllPlayers } from "./nba-api";
import { fetchLiveGames, fetchPlayerGamelog, fetchGameBoxScore, fetchTeamRoster } from "./espn-api";
import { fetchNbaEvents, fetchEventPlayerProps, isOddsApiConfigured, getOddsApiStatus } from "./odds-api";
import { fetchPrizePicksProjections, fetchPlayerPrizePicksProps } from "./prizepicks-api";

// Load sample players from external JSON file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePlayersPath = path.join(__dirname, "data", "sample-players.json");
const SAMPLE_PLAYERS: Player[] = JSON.parse(readFileSync(samplePlayersPath, "utf-8"));

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
  }> = [];

  const statTypes = ["PTS", "REB", "AST", "PRA", "FG3M", "STL", "BLK", "TOV", "STOCKS"];

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

        if (rate >= 80) {
          confidence = "HIGH";
          recommendation = "OVER";
        } else if (rate >= 65) {
          confidence = "MEDIUM";
          recommendation = "OVER";
        } else if (rate <= 25) {
          confidence = "HIGH";
          recommendation = "UNDER";
        } else if (rate <= 35) {
          confidence = "MEDIUM";
          recommendation = "UNDER";
        }

        if (confidence !== "LOW") {
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
          });
        }
      }
    }
  }

  return bets.sort((a, b) => {
    if (a.confidence === "HIGH" && b.confidence !== "HIGH") return -1;
    if (b.confidence === "HIGH" && a.confidence !== "HIGH") return 1;
    return b.hit_rate - a.hit_rate;
  });
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
      res.json(players);
    } catch (error) {
      console.error("Error fetching players:", error);
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

      res.json(player);
    } catch (error) {
      console.error("Error fetching player:", error);
      res.status(500).json({ error: "Failed to fetch player" });
    }
  });

  app.get("/api/search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query || query.trim().length === 0) {
        const players = await storage.getPlayers();
        return res.json(players);
      }

      const players = await storage.searchPlayers(query.trim());
      res.json(players);
    } catch (error) {
      console.error("Error searching players:", error);
      res.status(500).json({ error: "Failed to search players" });
    }
  });

  app.get("/api/bets", async (req, res) => {
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
      res.json(bets);
    } catch (error) {
      console.error("Error fetching bets:", error);
      res.status(500).json({ error: "Failed to fetch bets" });
    }
  });

  app.post("/api/bets/refresh", async (req, res) => {
    try {
      const players = await storage.getPlayers();
      const generatedBets = generatePotentialBets(players);
      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }
      const bets = await storage.getPotentialBets();
      res.json(bets);
    } catch (error) {
      console.error("Error refreshing bets:", error);
      res.status(500).json({ error: "Failed to refresh bets" });
    }
  });

  app.get("/api/sync/status", async (req, res) => {
    res.json({
      apiConfigured: true,
      message: "ESPN API is configured (Public). You can sync NBA data."
    });
  });

  app.post("/api/admin/sync-rosters", async (req, res) => {
    try {
      console.log("Starting NBA roster sync via ESPN...");

      const players = await fetchAndBuildAllPlayers((current, total) => {
        if (current % 50 === 0) {
          console.log(`Progress: ${current}/${total} players processed`);
        }
      });

      console.log(`Syncing ${players.length} players to database...`);

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
      const generatedBets = generatePotentialBets(dbPlayers);

      await storage.clearPotentialBets();
      for (const bet of generatedBets) {
        await storage.createPotentialBet(bet);
      }

      console.log("Sync complete!");

      res.json({
        success: true,
        playersCount: players.length,
        betsCount: generatedBets.length,
        message: `Successfully synced ${players.length} NBA players and generated ${generatedBets.length} betting opportunities.`
      });
    } catch (error) {
      console.error("Error syncing players:", error);
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
      res.json(games);
    } catch (error) {
      console.error("Error fetching live games:", error);
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
      console.error("Error fetching game details:", error);
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
      console.error("Error fetching team roster:", error);
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
      console.error("Error fetching player gamelog:", error);
      res.status(500).json({ error: "Failed to fetch player gamelog" });
    }
  });

  app.post("/api/projections", async (req, res) => {
    try {
      const { players } = req.body;
      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      // const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
      // Use absolute path relative to current module or project root
      // Assuming process.cwd() is the project root (where package.json is)
      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");

      console.log(`Running python script: ${scriptPath} with players: ${players.join(", ")}`);

      const pythonProcess = spawn("python", [scriptPath, "--players", ...players]);

      let dataString = "";
      let errorString = "";

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
        // Don't log everything as error, some might be warnings/logs
        // But keep it for debugging if it fails
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          console.error("Python script failed:", errorString);
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          res.json(json);
        } catch (e) {
          console.error("Failed to parse Python output. Data:", dataString);
          console.error("Stderr:", errorString);
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      console.error("Error generating projections:", error);
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
      console.error("Error fetching today's recommendations:", error);
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
      const pythonProcess = spawn("python", [scriptPath, "--players", player.player_name]);

      let dataString = "";
      let errorString = "";

      pythonProcess.stdout.on("data", (data) => {
        dataString += data.toString();
      });

      pythonProcess.stderr.on("data", (data) => {
        errorString += data.toString();
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          console.error("Python script failed:", errorString);
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
          const breakEven = 0.524;
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
          console.error("Failed to parse Python output:", dataString);
          res.status(500).json({ error: "Invalid response from model" });
        }
      });
    } catch (error) {
      console.error("Error generating projection:", error);
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
        const pythonProcess = spawn("python", [scriptPath, "--players", player.player_name]);

        const projection = await new Promise<number>((resolve, reject) => {
          let dataString = "";

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
      console.error("Error evaluating parlay:", error);
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
      console.error("Error fetching track record:", error);
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
      console.error("Error fetching sportsbooks:", error);
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
      console.error("Error fetching player lines:", error);
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
      console.error("Error fetching latest lines:", error);
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
      console.error("Error comparing lines:", error);
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
      console.error("Error fetching line movements:", error);
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
      console.error("Error fetching recent movements:", error);
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
      console.error("Error fetching best lines:", error);
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
      console.error("Error fetching best lines for date:", error);
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
      console.error("Error saving user bet:", error);
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
      console.error("Error fetching user bets:", error);
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
      console.error("Error updating bet result:", error);
      res.status(500).json({ error: "Failed to update bet result" });
    }
  });

  // =============== ODDS API ROUTES ===============

  // Check if odds API is configured
  app.get("/api/odds/status", async (_req, res) => {
    try {
      const status = await getOddsApiStatus();
      res.json(status);
    } catch (error) {
      console.error("Error checking odds API status:", error);
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
      console.error("Error fetching odds events:", error);
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
      console.error("Error fetching event props:", error);
      res.status(500).json({ error: "Failed to fetch player props" });
    }
  });

  // =============== PRIZEPICKS ROUTES ===============

  // Get all NBA PrizePicks projections
  app.get("/api/prizepicks/projections", async (_req, res) => {
    try {
      const projections = await fetchPrizePicksProjections();
      res.json(projections);
    } catch (error) {
      console.error("Error fetching PrizePicks projections:", error);
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
      console.error("Error fetching player PrizePicks props:", error);
      res.status(500).json({ error: "Failed to fetch player props" });
    }
  });

  return httpServer;
}
