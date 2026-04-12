import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { fetchLiveGames, fetchPlayerGamelog, fetchGameBoxScore, fetchTeamRoster } from "../espn-api";
import { fetchNbaEvents, extractGameOdds } from "../odds-api";

export function registerLiveRoutes(app: Express): void {
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

  // =============== LIVE SCORES (simplified for My Bets) ===============

  app.get("/api/live-scores", async (req, res) => {
    try {
      const dateStr = req.query.date as string | undefined;
      const games = await fetchLiveGames(dateStr);

      const scores = games.map((game) => {
        const home = game.competitors.find((c) => c.homeAway === "home");
        const away = game.competitors.find((c) => c.homeAway === "away");
        if (!home || !away) return null;

        const state = game.status?.type?.state || "pre";
        const completed = game.status?.type?.completed || false;

        return {
          gameId: game.id,
          state,
          completed,
          statusDetail: game.status?.type?.shortDetail || game.status?.type?.detail || "",
          period: game.status?.period || 0,
          clock: game.status?.displayClock || "",
          home: {
            abbreviation: home.team?.abbreviation || "",
            name: home.team?.shortDisplayName || home.team?.name || "",
            displayName: home.team?.displayName || "",
            score: home.score || "0",
            logo: home.team?.logo || "",
          },
          away: {
            abbreviation: away.team?.abbreviation || "",
            name: away.team?.shortDisplayName || away.team?.name || "",
            displayName: away.team?.displayName || "",
            score: away.score || "0",
            logo: away.team?.logo || "",
          },
        };
      }).filter(Boolean);

      res.json(scores);
    } catch (error) {
      apiLogger.error("Error fetching live scores:", error);
      res.status(500).json({ error: "Failed to fetch live scores" });
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

}
