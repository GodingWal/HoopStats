import type { Express } from "express";
import { storage } from "../storage";
import { apiLogger } from "../logger";
import { injuryWatcher } from "../injury-watcher";
import { getPlayerStatsByName, getActivePlayersWithStats } from "../services/balldontlie";
import { ensurePlayersLoaded } from "./route-helpers";
import type { Player } from "@shared/schema";

export function registerPlayerRoutes(app: Express): void {
  app.get("/api/players", async (req, res) => {
    try {
      let players = await ensurePlayersLoaded();

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

  // BallDontLie routes must be before /api/players/:id to avoid param matching
  app.get("/api/players/bdl-stats", async (req, res) => {
    try {
      const name = req.query.name as string;
      if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: "Provide at least 2 characters in 'name' query param" });
      }
      const stats = await getPlayerStatsByName(name.trim());
      if (!stats) {
        return res.status(404).json({ error: "Player not found or no stats available" });
      }
      res.json(stats);
    } catch (error) {
      apiLogger.error("Error fetching BallDontLie player stats", error);
      res.status(500).json({ error: "Failed to fetch player stats" });
    }
  });

  app.get("/api/players/bdl-active", async (req, res) => {
    try {
      const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
      const result = await getActivePlayersWithStats(cursor);
      res.json(result);
    } catch (error) {
      apiLogger.error("Error fetching active players from BallDontLie", error);
      res.status(500).json({ error: "Failed to fetch active players" });
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

}
