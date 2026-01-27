/**
 * Route aggregator - combines all route modules
 */

import { Express } from "express";
import { Server } from "http";
import playerRoutes from "./player-routes";
import betsRoutes from "./bets-routes";
import screenshotRoutes from "./screenshot-routes";
import { lineWatcher } from "../services/line-watcher";
import { apiLogger } from "../logger";

// Import remaining route handlers from legacy routes file
// These will be migrated to separate modules over time
import { registerLegacyRoutes } from "./legacy-routes";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Mount modular routes
  app.use("/api/players", playerRoutes);
  app.use("/api/bets", betsRoutes);
  app.use("/api/screenshots", screenshotRoutes);

  // Search endpoint (attached to root since it's /api/search not /api/players/search)
  app.get("/api/search", async (req, res) => {
    // Forward to player routes search handler
    const { storage } = await import("../storage");
    const { injuryWatcher } = await import("../injury-watcher");

    try {
      const query = req.query.q as string;
      let players;

      if (!query || query.trim().length === 0) {
        players = await storage.getPlayers();
      } else {
        players = await storage.searchPlayers(query.trim());
      }

      // Enrich with injuries
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
      apiLogger.error("Error searching players", error);
      res.status(500).json({ error: "Failed to search players" });
    }
  });

  // Register legacy routes (will be migrated incrementally)
  await registerLegacyRoutes(httpServer, app);

  // Start background services
  lineWatcher.start();

  return httpServer;
}
