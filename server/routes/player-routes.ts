/**
 * Player-related API routes
 */

import { Router } from "express";
import { storage } from "../storage";
import { injuryWatcher } from "../injury-watcher";
import { apiLogger } from "../logger";
import { validatePositiveInt } from "../validation";
import type { Player } from "@shared/schema";

const router = Router();

// Helper to enrich players with injury status
function enrichWithInjuries(players: Player[]) {
  const allInjuries = injuryWatcher.getKnownInjuries();
  return players.map(player => {
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
}

/**
 * GET /api/players
 * Get all players with injury status
 */
router.get("/", async (req, res) => {
  try {
    let players = await storage.getPlayers();

    // Seed sample players if none exist
    if (players.length === 0) {
      const { SAMPLE_PLAYERS } = await import("../data/sample-players-loader");
      await storage.seedPlayers(SAMPLE_PLAYERS);
      players = await storage.getPlayers();
    }

    const playersWithInjuries = enrichWithInjuries(players);
    res.json(playersWithInjuries);
  } catch (error) {
    apiLogger.error("Error fetching players", error);
    res.status(500).json({ error: "Failed to fetch players" });
  }
});

/**
 * GET /api/players/:id
 * Get a single player by ID with injury status
 */
router.get("/:id", async (req, res) => {
  try {
    const id = validatePositiveInt(req.params.id, "Player ID");

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
    apiLogger.error("Error fetching player", error);
    res.status(500).json({ error: "Failed to fetch player" });
  }
});

/**
 * GET /api/players/:id/gamelog
 * Get player game log
 */
router.get("/:id/gamelog", async (req, res) => {
  try {
    const playerId = req.params.id;
    if (!playerId) {
      return res.status(400).json({ error: "Missing player ID" });
    }

    const { fetchPlayerGamelog } = await import("../espn-api");
    const gamelog = await fetchPlayerGamelog(playerId);
    res.json(gamelog);
  } catch (error) {
    apiLogger.error("Error fetching player gamelog", error);
    res.status(500).json({ error: "Failed to fetch player gamelog" });
  }
});

/**
 * GET /api/search
 * Search players by name or team
 */
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q as string;
    let players;

    if (!query || query.trim().length === 0) {
      players = await storage.getPlayers();
    } else {
      players = await storage.searchPlayers(query.trim());
    }

    const playersWithInjuries = enrichWithInjuries(players);
    res.json(playersWithInjuries);
  } catch (error) {
    apiLogger.error("Error searching players", error);
    res.status(500).json({ error: "Failed to search players" });
  }
});

export default router;
