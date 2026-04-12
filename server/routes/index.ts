/**
 * Route aggregator - imports and registers all route modules
 */
import type { Express } from "express";
import { type Server } from "http";
import bankrollRoutes from "./bankroll-routes";
import { registerPlayerRoutes } from "./player-routes";
import { registerBetsRoutes } from "./bets-routes";
import { registerAdminRoutes } from "./admin-routes";
import { registerLiveRoutes } from "./live-routes";
import { registerProjectionRoutes } from "./projection-routes";
import { registerLinesRoutes } from "./lines-routes";
import { registerParlayRoutes } from "./parlay-routes";
import { registerStatsRoutes } from "./stats-routes";
import { registerPrizePicksRoutes } from "./prizepicks-routes";
import { registerInjuryRoutes } from "./injury-routes";
import { registerSplitsRoutes } from "./splits-routes";
import { registerTeamsRoutes } from "./teams-routes";
import { registerBacktestRoutes } from "./backtest-routes";
import { registerSignalsRoutes } from "./signals-routes";
import { registerMlRoutes } from "./ml-routes";
import { lineWatcher } from "../services/line-watcher";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Mount router-based modules
  app.use("/api/bankroll", bankrollRoutes);

  // Register function-based route modules
  registerPlayerRoutes(app);
  registerBetsRoutes(app);
  registerAdminRoutes(app);
  registerLiveRoutes(app);
  registerProjectionRoutes(app);
  registerLinesRoutes(app);
  registerParlayRoutes(app);
  registerStatsRoutes(app);
  registerPrizePicksRoutes(app);
  registerInjuryRoutes(app);
  registerSplitsRoutes(app);
  registerTeamsRoutes(app);
  registerBacktestRoutes(app);
  registerSignalsRoutes(app);
  registerMlRoutes(app);

  // Start background services
  lineWatcher.start();

  return httpServer;
}
