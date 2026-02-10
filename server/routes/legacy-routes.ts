/**
 * Legacy routes - contains routes that haven't been migrated to modular structure yet
 * These will be incrementally moved to separate route modules
 */

import type { Express } from "express";
import type { Server } from "http";
import { spawn } from "child_process";
import path from "path";

import { storage } from "../storage";
import { apiLogger } from "../logger";
import { BETTING_CONFIG, CACHE_CONFIG, API_CONFIG } from "../constants";
import { validatePositiveInt, validateOptionalInt, validateOptionalFloat } from "../validation";
import { fetchAndBuildAllPlayers } from "../nba-api";
import {
  fetchLiveGames,
  fetchGameBoxScore,
  fetchTeamRoster,
  fetchTodaysGameInjuries,
  fetchAllNbaInjuries,
  getTeamOutPlayers,
  type PlayerInjuryReport,
} from "../espn-api";
import { fetchNbaEvents, fetchEventPlayerProps, isOddsApiConfigured, getOddsApiStatus, extractGameOdds } from "../odds-api";
import { fetchPrizePicksProjections, fetchPlayerPrizePicksProps, fetchDemonProjections } from "../prizepicks-api";
import {
  injuryWatcher,
  calculateInjuryAdjustedProjection,
  calculateInjuryEdgeChange,
} from "../injury-watcher";
import { onOffService } from "../on-off-service";
import {
  fetchTeamStats,
  fetchTeamRecentGames,
  fetchTeamRotation,
  compareTeams,
  getAllTeamsInfo,
} from "../team-stats-api";
import { generateBetsFromPrizePicks } from "./bets-routes";
import { SAMPLE_PLAYERS } from "../data/sample-players-loader";

// Get Python command based on platform
function getPythonCommand(): string {
  if (process.platform === 'win32') {
    return 'python';
  }
  // On Linux, use the venv Python in the nba-prop-model directory
  return path.join(process.cwd(), 'server', 'nba-prop-model', 'venv', 'bin', 'python');
}

// Probability helper functions
function normalCDF(x: number, mean: number, std: number): number {
  const z = (x - mean) / std;
  return 0.5 * (1 + erf(z / Math.sqrt(2)));
}

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

export async function registerLegacyRoutes(
  httpServer: Server,
  app: Express
): Promise<void> {

  // =============== ALERTS ===============

  app.get("/api/alerts", async (req, res) => {
    try {
      const alerts = await storage.getAlerts({ limit: API_CONFIG.DEFAULT_ALERTS_LIMIT });
      res.json(alerts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch alerts" });
    }
  });

  app.post("/api/alerts/:id/read", async (req, res) => {
    try {
      await storage.markAlertAsRead(parseInt(req.params.id, 10));
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark alert as read" });
    }
  });

  // =============== SYNC STATUS ===============

  app.get("/api/sync/status", async (req, res) => {
    res.json({
      apiConfigured: true,
      message: "ESPN API is configured (Public). You can sync NBA data."
    });
  });

  // =============== ADMIN SYNC ===============

  app.post("/api/admin/sync-rosters", async (req, res) => {
    try {
      apiLogger.info("Starting NBA roster sync via ESPN...");

      const players = await fetchAndBuildAllPlayers((current, total) => {
        if (current % 50 === 0) {
          apiLogger.info(`Progress: ${current}/${total} players processed`);
        }
      });

      apiLogger.info(`Syncing ${players.length} players to database...`);

      await storage.clearPlayers();
      await storage.syncPlayers(players);

      const dbPlayers = await storage.getPlayers();

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
      apiLogger.error("Error syncing players", error);
      res.status(500).json({
        error: "Failed to sync players",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.post("/api/sync/players", async (req, res) => {
    res.redirect(307, "/api/admin/sync-rosters");
  });

  // =============== LIVE GAMES ===============

  app.get("/api/live-games", async (req, res) => {
    try {
      const dateStr = req.query.date as string | undefined;
      const games = await fetchLiveGames(dateStr);

      if (games.length > 0) {
        try {
          const oddsEvents = await fetchNbaEvents();

          for (const game of games) {
            const homeTeam = game.competitors.find(c => c.homeAway === 'home')?.team;
            const awayTeam = game.competitors.find(c => c.homeAway === 'away')?.team;

            if (!homeTeam || !awayTeam) continue;

            const match = oddsEvents.find(e => {
              const homeMatch = e.home_team.includes(homeTeam.name) || e.home_team.includes(homeTeam.displayName);
              const awayMatch = e.away_team.includes(awayTeam.name) || e.away_team.includes(awayTeam.displayName);
              return homeMatch && awayMatch;
            });

            if (match) {
              const gameOdds = extractGameOdds(match);
              if (gameOdds) {
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
          apiLogger.error("Error fetching/merging odds", oddsError);
        }
      }

      res.json(games);
    } catch (error) {
      apiLogger.error("Error fetching live games", error);
      res.status(500).json({ error: "Failed to fetch live games" });
    }
  });

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
      apiLogger.error("Error fetching game details", error);
      res.status(500).json({ error: "Failed to fetch game details" });
    }
  });

  app.get("/api/teams/:teamId/roster", async (req, res) => {
    try {
      const { teamId } = req.params;
      if (!teamId) {
        return res.status(400).json({ error: "Missing team ID" });
      }
      const roster = await fetchTeamRoster(teamId);
      res.json(roster);
    } catch (error) {
      apiLogger.error("Error fetching team roster", error);
      res.status(500).json({ error: "Failed to fetch team roster" });
    }
  });

  // =============== PROJECTIONS ===============

  app.post("/api/projections", async (req, res) => {
    try {
      const { players, includeInjuries = true } = req.body;
      if (!players || !Array.isArray(players) || players.length === 0) {
        return res.status(400).json({ error: "Invalid players list" });
      }

      const scriptPath = path.join(process.cwd(), "server", "nba-prop-model", "api.py");
      const args = ["--players", ...players];

      let injuredPlayers: string[] = [];
      if (includeInjuries) {
        try {
          const injuries = await fetchTodaysGameInjuries();
          const injuredMinutesMap: Record<string, number> = {};

          injuries.forEach(inj => {
            if (inj.status === 'out') {
              injuredMinutesMap[inj.playerName] = 25.0;
              injuredPlayers.push(inj.playerName);
            }
          });

          if (injuredPlayers.length > 0) {
            args.push("--injured_minutes", JSON.stringify(injuredMinutesMap));
          }
        } catch (injError) {
          apiLogger.warn("Could not fetch injuries for projections", { error: injError });
        }
      }

      apiLogger.info(`Running python script with players: ${players.join(", ")}`);
      if (injuredPlayers.length > 0) {
        apiLogger.info(`Injuries factored in: ${injuredPlayers.join(", ")}`);
      }

      const pythonProcess = spawn(getPythonCommand(), [scriptPath, ...args]);

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
          apiLogger.error("Python script failed", { error: errorString });
          return res.status(500).json({ error: "Projections failed", details: errorString });
        }
        try {
          const json = JSON.parse(dataString);
          res.json({
            ...json,
            injuryContext: {
              injuriesIncluded: includeInjuries,
              injuredPlayers: injuredPlayers,
              injuryCount: injuredPlayers.length,
            }
          });
        } catch (e) {
          apiLogger.error("Failed to parse Python output", { data: dataString, stderr: errorString });
          res.status(500).json({ error: "Invalid response from model", details: errorString });
        }
      });
    } catch (error) {
      apiLogger.error("Error generating projections", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // =============== RECOMMENDATIONS ===============

  app.get("/api/recommendations/today", async (req, res) => {
    try {
      const minEdge = validateOptionalFloat(req.query.minEdge as string, BETTING_CONFIG.EDGE_THRESHOLDS.MIN_EDGE, "minEdge");
      const recommendations = await storage.getTodaysRecommendations();
      const filtered = recommendations.filter(r => r.edge >= minEdge);
      res.json(filtered);
    } catch (error) {
      apiLogger.error("Error fetching today's recommendations", error);
      res.status(500).json({ error: "Failed to fetch recommendations" });
    }
  });

  // =============== TRACK RECORD ===============

  app.get("/api/track-record", async (req, res) => {
    try {
      const days = validateOptionalInt(req.query.days as string, BETTING_CONFIG.DEFAULT_TRACK_RECORD_DAYS, "days");
      const record = await storage.getTrackRecord(days);
      res.json(record);
    } catch (error) {
      apiLogger.error("Error fetching track record", error);
      res.status(500).json({ error: "Failed to fetch track record" });
    }
  });

  // =============== SPORTSBOOKS ===============

  app.get("/api/sportsbooks", async (req, res) => {
    try {
      const books = await storage.getSportsbooks();
      res.json(books);
    } catch (error) {
      apiLogger.error("Error fetching sportsbooks", error);
      res.status(500).json({ error: "Failed to fetch sportsbooks" });
    }
  });

  // =============== LINES ===============

  app.get("/api/lines/player/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (!stat) {
        return res.status(400).json({ error: "stat parameter is required" });
      }

      const lines = await storage.getPlayerPropLines(playerId, stat, gameDate);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching player lines", error);
      res.status(500).json({ error: "Failed to fetch player lines" });
    }
  });

  app.get("/api/lines/latest/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string;

      if (!stat) {
        return res.status(400).json({ error: "stat parameter is required" });
      }

      const lines = await storage.getLatestLines(playerId, stat);
      res.json(lines);
    } catch (error) {
      apiLogger.error("Error fetching latest lines", error);
      res.status(500).json({ error: "Failed to fetch latest lines" });
    }
  });

  app.get("/api/lines/compare/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string;

      if (!stat || !gameDate) {
        return res.status(400).json({ error: "stat and gameDate parameters are required" });
      }

      const comparison = await storage.compareLines(playerId, stat, gameDate);
      res.json(comparison);
    } catch (error) {
      apiLogger.error("Error comparing lines", error);
      res.status(500).json({ error: "Failed to compare lines" });
    }
  });

  app.get("/api/lines/movements/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string;
      const gameDate = req.query.gameDate as string | undefined;

      if (!stat) {
        return res.status(400).json({ error: "stat parameter is required" });
      }

      const movements = await storage.getLineMovements(playerId, stat, gameDate);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching line movements", error);
      res.status(500).json({ error: "Failed to fetch line movements" });
    }
  });

  app.get("/api/lines/movements/recent", async (req, res) => {
    try {
      const hours = validateOptionalInt(req.query.hours as string, API_CONFIG.DEFAULT_LINE_MOVEMENTS_HOURS, "hours");
      const movements = await storage.getRecentLineMovements(hours);
      res.json(movements);
    } catch (error) {
      apiLogger.error("Error fetching recent movements", error);
      res.status(500).json({ error: "Failed to fetch recent movements" });
    }
  });

  app.get("/api/lines/best/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string;

      if (!stat) {
        return res.status(400).json({ error: "stat parameter is required" });
      }

      const bestLines = await storage.getBestLines(playerId, stat);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  app.get("/api/lines/best/date/:gameDate", async (req, res) => {
    try {
      const { gameDate } = req.params;
      const bestLines = await storage.getBestLinesForDate(gameDate);
      res.json(bestLines);
    } catch (error) {
      apiLogger.error("Error fetching best lines for date", error);
      res.status(500).json({ error: "Failed to fetch best lines" });
    }
  });

  // =============== PARLAYS ===============

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
      apiLogger.error("Error saving parlay", error);
      res.status(500).json({ error: "Failed to save parlay" });
    }
  });

  app.get("/api/parlays", async (req, res) => {
    try {
      const pending = req.query.pending === 'true';
      const parlays = await storage.getParlays({ pending });
      res.json(parlays);
    } catch (error) {
      apiLogger.error("Error fetching parlays", error);
      res.status(500).json({ error: "Failed to fetch parlays" });
    }
  });

  app.patch("/api/parlays/:parlayId", async (req, res) => {
    try {
      const parlayId = validatePositiveInt(req.params.parlayId, "parlayId");
      const { result, profit } = req.body;
      const updatedParlay = await storage.updateParlayResult(parlayId, result, profit);
      res.json(updatedParlay);
    } catch (error) {
      apiLogger.error("Error updating parlay result", error);
      res.status(500).json({ error: "Failed to update parlay result" });
    }
  });

  app.patch("/api/parlays/:parlayId/picks/:pickId", async (req, res) => {
    try {
      const pickId = validatePositiveInt(req.params.pickId, "pickId");
      const { result, actualValue } = req.body;
      const updatedPick = await storage.updateParlayPickResult(pickId, result, actualValue);
      res.json(updatedPick);
    } catch (error) {
      apiLogger.error("Error updating pick result", error);
      res.status(500).json({ error: "Failed to update pick result" });
    }
  });

  // =============== ODDS API ===============

  app.get("/api/odds/status", async (_req, res) => {
    try {
      const status = await getOddsApiStatus();
      res.json(status);
    } catch (error) {
      apiLogger.error("Error checking odds API status", error);
      res.status(500).json({ error: "Failed to check odds API status" });
    }
  });

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
      apiLogger.error("Error fetching odds events", error);
      res.status(500).json({ error: "Failed to fetch odds events" });
    }
  });

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
      apiLogger.error("Error fetching event props", error);
      res.status(500).json({ error: "Failed to fetch event props" });
    }
  });

  // =============== PRIZEPICKS ===============

  app.get("/api/prizepicks/projections", async (_req, res) => {
    try {
      const projections = await fetchPrizePicksProjections();
      res.json(projections);
    } catch (error) {
      apiLogger.error("Error fetching PrizePicks projections", error);
      res.status(500).json({
        error: "Failed to fetch PrizePicks projections",
        message: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/prizepicks/demons", async (req, res) => {
    try {
      const demons = await fetchDemonProjections();

      // Enrich with player averages from our database for over/under analysis
      const enriched = await Promise.all(
        demons.map(async (demon) => {
          try {
            const players = await storage.searchPlayers(demon.playerName);
            const player = players.length > 0 ? players[0] : null;

            if (!player) return { ...demon, playerAvg: null, overLikelihood: null };

            const seasonAvg = player.season_averages as Record<string, number> | null;
            const last5Avg = player.last_5_averages as Record<string, number> | null;
            const last10Avg = player.last_10_averages as Record<string, number> | null;
            const hitRates = player.hit_rates as Record<string, Record<string, number>> | null;

            // Map PrizePicks stat abbr to our schema fields
            const statMap: Record<string, string> = {
              PTS: "PTS",
              REB: "REB",
              AST: "AST",
              FG3M: "FG3M",
              PRA: "PRA",
              STL: "STL",
              BLK: "BLK",
              TO: "TOV",
              PR: "PR",
              PA: "PA",
              RA: "RA",
            };

            const statKey = statMap[demon.statTypeAbbr] || demon.statTypeAbbr;
            const seasonVal = seasonAvg?.[statKey] ?? null;
            const last5Val = last5Avg?.[statKey] ?? null;
            const last10Val = last10Avg?.[statKey] ?? null;

            // Calculate over likelihood based on averages vs line
            let overLikelihood: number | null = null;
            if (seasonVal !== null) {
              // Weighted average: last5 (50%), last10 (30%), season (20%)
              const weightedAvg =
                (last5Val ?? seasonVal) * 0.5 +
                (last10Val ?? seasonVal) * 0.3 +
                seasonVal * 0.2;
              // Simple edge calculation: how far above/below the line
              overLikelihood = ((weightedAvg - demon.line) / demon.line) * 100;
            }

            // Get hit rate for this stat at nearest line if available
            let hitRate: number | null = null;
            if (hitRates && hitRates[statKey]) {
              const lineStr = String(demon.line);
              hitRate = hitRates[statKey][lineStr] ?? null;
              // If exact line not found, check nearby half-point lines
              if (hitRate === null) {
                const nearestLine = Object.keys(hitRates[statKey])
                  .map(Number)
                  .sort((a, b) => Math.abs(a - demon.line) - Math.abs(b - demon.line))[0];
                if (nearestLine !== undefined && Math.abs(nearestLine - demon.line) <= 1) {
                  hitRate = hitRates[statKey][String(nearestLine)] ?? null;
                }
              }
            }

            return {
              ...demon,
              playerAvg: {
                season: seasonVal,
                last5: last5Val,
                last10: last10Val,
              },
              hitRate,
              overLikelihood,
            };
          } catch {
            return { ...demon, playerAvg: null, overLikelihood: null };
          }
        })
      );

      // Sort by over likelihood descending (most likely overs first)
      enriched.sort((a, b) => (b.overLikelihood ?? -999) - (a.overLikelihood ?? -999));

      res.json(enriched);
    } catch (error) {
      apiLogger.error("Error fetching demon projections", error);
      res.status(500).json({
        error: "Failed to fetch demon projections",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  app.get("/api/prizepicks/player/:playerName", async (req, res) => {
    try {
      const { playerName } = req.params;
      if (!playerName) {
        return res.status(400).json({ error: "Player name is required" });
      }

      const props = await fetchPlayerPrizePicksProps(decodeURIComponent(playerName));
      res.json(props);
    } catch (error) {
      apiLogger.error("Error fetching player PrizePicks props", error);
      res.status(500).json({ error: "Failed to fetch player props" });
    }
  });

  // =============== INJURIES ===============

  app.get("/api/injuries/status", async (_req, res) => {
    try {
      res.json({
        isActive: injuryWatcher.isActive(),
        lastCheck: injuryWatcher.getLastCheckTime(),
        knownInjuries: injuryWatcher.getKnownInjuries().length,
      });
    } catch (error) {
      apiLogger.error("Error fetching injury status", error);
      res.status(500).json({ error: "Failed to fetch injury status" });
    }
  });

  app.post("/api/injuries/start", async (req, res) => {
    try {
      const intervalMs = validateOptionalInt(req.query.interval as string, CACHE_CONFIG.INJURY_WATCHER_INTERVAL_MS, "interval");
      await injuryWatcher.start(intervalMs);
      res.json({
        success: true,
        message: `Injury watcher started with ${intervalMs}ms interval`,
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error starting injury watcher", error);
      res.status(500).json({ error: "Failed to start injury watcher" });
    }
  });

  app.post("/api/injuries/stop", async (_req, res) => {
    try {
      injuryWatcher.stop();
      res.json({
        success: true,
        message: "Injury watcher stopped",
        isActive: injuryWatcher.isActive(),
      });
    } catch (error) {
      apiLogger.error("Error stopping injury watcher", error);
      res.status(500).json({ error: "Failed to stop injury watcher" });
    }
  });

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
      apiLogger.error("Error checking injuries", error);
      res.status(500).json({ error: "Failed to check injuries" });
    }
  });

  app.get("/api/injuries/today", async (_req, res) => {
    try {
      const injuries = await fetchTodaysGameInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching today's injuries", error);
      res.status(500).json({ error: "Failed to fetch today's injuries" });
    }
  });

  app.get("/api/injuries/all", async (_req, res) => {
    try {
      const injuries = await fetchAllNbaInjuries();
      res.json({
        injuries,
        count: injuries.length,
        fetchedAt: new Date().toISOString(),
      });
    } catch (error) {
      apiLogger.error("Error fetching all injuries", error);
      res.status(500).json({ error: "Failed to fetch all injuries" });
    }
  });

  app.get("/api/injuries/team/:teamAbbr", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      if (!teamAbbr) {
        return res.status(400).json({ error: "Team abbreviation is required" });
      }

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
      apiLogger.error("Error fetching team injuries", error);
      res.status(500).json({ error: "Failed to fetch team injuries" });
    }
  });

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
      apiLogger.error("Error fetching out players", error);
      res.status(500).json({ error: "Failed to fetch out players" });
    }
  });

  app.get("/api/injuries/opportunities", async (req, res) => {
    try {
      const injuries = await fetchTodaysGameInjuries();
      const outByTeam = new Map<string, string[]>();

      for (const inj of injuries) {
        if (inj.status === 'out') {
          const teamOuts = outByTeam.get(inj.team) || [];
          teamOuts.push(inj.playerName);
          outByTeam.set(inj.team, teamOuts);
        }
      }

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
      apiLogger.error("Error fetching injury opportunities", error);
      res.status(500).json({ error: "Failed to fetch injury opportunities" });
    }
  });

  // =============== ON/OFF SPLITS ===============

  app.get("/api/splits/without-player/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const { season } = req.query;

      let splits = await onOffService.getSplitsForPlayer(playerId, season as string | undefined);

      if (splits.length === 0) {
        try {
          const player = await storage.getPlayer(playerId);
          const playerName = player?.player_name || req.query.playerName as string;
          const team = player?.team || req.query.team as string;

          if (playerName && team) {
            apiLogger.info(`No splits found for ${playerName}. Auto-calculating...`);
            await onOffService.calculateSplitsForPlayer(playerId, playerName, team);
            splits = await onOffService.getSplitsForPlayer(playerId, season as string | undefined);
          }
        } catch (calcError) {
          apiLogger.error("Auto-calculation failed", calcError);
        }
      }

      const validSplits = splits.filter(s => s.gamesWithoutTeammate >= 2);
      const sortedSplits = validSplits.sort((a, b) => {
        const aDelta = a.ptsDelta ?? 0;
        const bDelta = b.ptsDelta ?? 0;
        return bDelta - aDelta;
      });

      res.json({
        playerId,
        splits: sortedSplits,
        count: sortedSplits.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching on/off splits", error);
      res.status(500).json({ error: "Failed to fetch on/off splits" });
    }
  });

  app.get("/api/splits/biggest-beneficiaries/:playerId", async (req, res) => {
    try {
      const playerId = validatePositiveInt(req.params.playerId, "playerId");
      const stat = req.query.stat as string || 'pts';
      const limit = validateOptionalInt(req.query.limit as string, API_CONFIG.TOP_BENEFICIARIES_LIMIT, "limit");

      if (!['pts', 'reb', 'ast'].includes(stat)) {
        return res.status(400).json({ error: "Stat must be pts, reb, or ast" });
      }

      const beneficiaries = await onOffService.getTopBeneficiaries(playerId, stat as 'pts' | 'reb' | 'ast', limit);

      res.json({
        playerId,
        stat,
        beneficiaries,
        count: beneficiaries.length,
      });
    } catch (error) {
      apiLogger.error("Error fetching top beneficiaries", error);
      res.status(500).json({ error: "Failed to fetch top beneficiaries" });
    }
  });

  // =============== TEAM STATS ===============

  app.get("/api/teams", async (_req, res) => {
    try {
      const teams = getAllTeamsInfo();
      res.json(teams);
    } catch (error) {
      apiLogger.error("Error fetching teams", error);
      res.status(500).json({ error: "Failed to fetch teams" });
    }
  });

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
      apiLogger.error("Error fetching team stats", error);
      res.status(500).json({ error: "Failed to fetch team stats" });
    }
  });

  app.get("/api/teams/:teamAbbr/games", async (req, res) => {
    try {
      const { teamAbbr } = req.params;
      const limit = validateOptionalInt(req.query.limit as string, API_CONFIG.DEFAULT_TEAM_GAMES_LIMIT, "limit");

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
      apiLogger.error("Error fetching team games", error);
      res.status(500).json({ error: "Failed to fetch team games" });
    }
  });

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
      apiLogger.error("Error comparing teams", error);
      res.status(500).json({ error: "Failed to compare teams" });
    }
  });

  // Note: Additional routes from original routes.ts would go here
  // For brevity, this covers the main patterns - the rest follow the same structure
}
