import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { injuryWatcher } from "./injury-watcher";
import { injuryImpactService } from "./injury-impact-service";
import { prizePicksLineTracker } from "./prizepicks-line-tracker";
import { prizePicksStorage } from "./storage/prizepicks-storage";
import { autoSettlementService } from "./services/auto-settle";
import { startBacktestScheduler } from "./services/backtest-scheduler";
import { serverLogger } from "./logger";

// Warn about missing optional API keys at startup so developers know what features are disabled
const OPTIONAL_ENV_VARS: Array<{ key: string; feature: string }> = [
  { key: "DATABASE_URL", feature: "persistent database storage" },
  { key: "ODDS_API_KEY", feature: "live sportsbook odds" },
  { key: "BALLDONTLIE_API_KEY", feature: "BallDontLie player stats" },
  { key: "ANTHROPIC_API_KEY", feature: "AI bet explanations and vision parsing" },
];

for (const { key, feature } of OPTIONAL_ENV_VARS) {
  if (!process.env[key]) {
    serverLogger.warn(`${key} not set - ${feature} will be unavailable`);
  }
}
import {
  corsMiddleware,
  apiRateLimiter,
  expensiveRateLimiter,
  securityHeaders,
  healthCheck,
} from "./middleware";
import { setupApiDocs } from "./api-docs";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// Security headers
app.use(securityHeaders);

// CORS configuration
app.use(corsMiddleware);

// Body parsing (20mb limit to support base64 image uploads)
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "20mb" }));

// Health check endpoint (no rate limiting)
app.get("/health", healthCheck);
app.get("/api/health", healthCheck);

// Rate limiting for API routes
app.use("/api", apiRateLimiter);

// Stricter rate limiting for expensive operations
app.use("/api/admin/sync-rosters", expensiveRateLimiter);
app.use("/api/sync/players", expensiveRateLimiter);
app.use("/api/projections", expensiveRateLimiter);
app.use("/api/stats/advanced", expensiveRateLimiter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // Use logger instead of console.log
  serverLogger.info(`[${source}] ${message}`);
}

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Only log response body for errors or in verbose mode
      if (res.statusCode >= 400 && capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse).slice(0, 200)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Setup API documentation (available at /api-docs)
  setupApiDocs(app);

  await registerRoutes(httpServer, app);

  app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "127.0.0.1",
    },
    () => {
      serverLogger.info(`Server listening on port ${port}`);

      // Start injury monitoring for edge detection
      injuryWatcher.start();
      serverLogger.info("Injury watcher started - monitoring for player status updates");

      // Start automated injury impact calculations
      injuryImpactService.start();
      serverLogger.info("Injury impact service started - auto-updating bet edges on injury changes");

      // Start PrizePicks line tracking (polls every 5 minutes by default)
      prizePicksLineTracker.setStorage(prizePicksStorage);
      prizePicksLineTracker.start(900000); // 15 minutes
      serverLogger.info("PrizePicks line tracker started (15-min interval) - capturing historical line data");

      // Log significant line movements
      prizePicksLineTracker.on('significant-movement', (movement) => {
        serverLogger.info(`PrizePicks line movement: ${movement.playerName} ${movement.statType} ${movement.oldLine} -> ${movement.newLine}`);
      });

      // Start auto-settlement service (checks every 5 minutes)
      autoSettlementService.start(5 * 60 * 1000);
      serverLogger.info("Auto-settlement service started - settling picks every 5 minutes");

      // Start backtest data scheduler (capture, actuals, validation on cron)
      startBacktestScheduler();
    },
  );
})();
