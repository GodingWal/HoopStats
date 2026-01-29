# Courtside Edge - Improvement Recommendations

This document outlines recommended improvements for the Courtside Edge codebase, organized by priority and category.

---

## Completed Improvements

The following improvements have been **implemented** and are no longer actionable:

| # | Improvement | Location |
|---|-------------|----------|
| 1 | Remove duplicate route handler | `server/routes.ts` |
| 2 | Create constants file | `server/constants.ts` |
| 3 | Create validation utilities | `server/validation.ts` |
| 4 | Replace console.log with logger | All server files |
| 5 | Split routes into modules | `server/routes/` |
| 6 | Split storage into modules | `server/storage/` |
| 7 | Add rate limiting | `server/middleware.ts` |
| 8 | Add CORS configuration | `server/middleware.ts` |
| 9 | Split React bet components | `client/src/components/bets/` |
| 10 | Add transaction support | `server/storage/base.ts` |
| 11 | Add integration tests | `server/__tests__/api.integration.test.ts` |
| 12 | Add API documentation (Swagger) | `server/api-docs.ts` → `/api-docs` |

---

## Executive Summary

The foundational quality work (validation, logging, modular architecture, testing, rate limiting) is in place. The next phase of improvements focuses on **resilience**, **observability**, **performance**, and **developer experience** — the areas that matter most as the platform scales to handle real-time betting data under production load.

**Codebase Stats:**
- ~24,186 lines of TypeScript/Python
- React 18 + Vite frontend, Express.js + PostgreSQL backend
- 60+ UI components, 63 API endpoints, 4 external API integrations

---

## High Priority

### 1. Add Circuit Breakers for External API Calls

**Problem:** The app depends on ESPN, TheOddsAPI, PrizePicks, and NBA official APIs. If any of these go down or become slow, requests will hang or cascade failures through the backend.

**Current state:** No timeout, retry, or fallback logic on external HTTP calls.

**Recommendation:** Use a circuit breaker library (e.g., `cockatiel` or `opossum`) to wrap external calls:

```typescript
import { CircuitBreakerPolicy, handleAll, retry, circuitBreaker, wrap } from "cockatiel";

const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: { type: "exponential" } });
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 30_000,
  breaker: { threshold: 0.5, duration: 10_000, minimumRps: 5 },
});
const resilientPolicy = wrap(retryPolicy, breakerPolicy);

// Usage
const data = await resilientPolicy.execute(() => fetchFromESPN(gameId));
```

**Also add:** `AbortController` timeouts on all `fetch()` calls (default 10s for APIs, 30s for scraping).

**Files affected:** `server/espn-api.ts`, `server/nba-api.ts`, `server/prizepicks-api.ts`

---

### 2. Add Request Correlation IDs and Structured Logging

**Problem:** When debugging production issues, there is no way to trace a single user request through logs across middleware, routes, storage, and external API calls.

**Recommendation:** Add a correlation ID middleware and pass it through the logger:

```typescript
// middleware.ts
import { randomUUID } from "crypto";

app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] as string || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
});
```

Update the logger to accept context and always include the request ID:

```typescript
apiLogger.info("Fetching player projections", { requestId: req.id, playerId });
```

**Bonus:** Emit logs as JSON in production for ingestion by log aggregators (ELK, Datadog, etc.):

```typescript
if (process.env.NODE_ENV === "production") {
  // JSON output: {"level":"info","msg":"...","requestId":"...","timestamp":"..."}
}
```

---

### 3. Migrate In-Memory Cache to Redis

**Problem:** The current `cache.ts` uses an in-memory Map with TTL. This means:
- Cache is lost on every server restart or deploy
- Cache cannot be shared across multiple server instances
- No eviction policy — unbounded memory growth under load

**Recommendation:** Replace with Redis (already in `docker-compose.yml` but unused by the app):

```typescript
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });

export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  return data ? JSON.parse(data) : null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.setEx(key, ttlSeconds, JSON.stringify(value));
}
```

Keep the in-memory cache as a fallback when `REDIS_URL` is not configured (local dev).

**Files affected:** `server/cache.ts`, `docker-compose.yml` (connect app to Redis)

---

### 4. Finish Splitting the Monolithic Routes File

**Problem:** `server/routes.ts` is still 2,461 lines. While `server/routes/` exists with some modules, the main file remains a monolith containing most endpoints.

**Recommendation:** Complete the migration so `server/routes.ts` becomes a thin aggregator:

```typescript
// server/routes.ts (target: <50 lines)
import { registerPlayerRoutes } from "./routes/players";
import { registerBetRoutes } from "./routes/bets";
import { registerProjectionRoutes } from "./routes/projections";
import { registerLiveGameRoutes } from "./routes/live-games";
import { registerTrackRecordRoutes } from "./routes/track-record";
import { registerParlayRoutes } from "./routes/parlays";
import { registerAdminRoutes } from "./routes/admin";

export function registerRoutes(app: Express) {
  registerPlayerRoutes(app);
  registerBetRoutes(app);
  registerProjectionRoutes(app);
  registerLiveGameRoutes(app);
  registerTrackRecordRoutes(app);
  registerParlayRoutes(app);
  registerAdminRoutes(app);
}
```

---

### 5. Refactor Large Page Components

**Problem:** Several React pages are 500–960+ lines with mixed concerns (data fetching, parsing, state management, rendering).

| File | Lines | Issues |
|------|-------|--------|
| `client/src/pages/bets.tsx` | 966 | Bet parsing logic mixed with UI |
| `client/src/pages/team-stats.tsx` | 894 | Multiple chart types in one component |
| `client/src/pages/my-bets.tsx` | 618 | Parsing + filtering + rendering |
| `client/src/pages/projections.tsx` | 577 | Projection logic + display mixed |

**Recommendation:** For each page, extract:
1. **Custom hooks** for data fetching and state logic (e.g., `useBetParser()`, `useTeamStats()`)
2. **Sub-components** for distinct UI sections (e.g., `<BetFilters />`, `<BetTable />`, `<BetStats />`)
3. **Utility functions** for parsing/transformation logic into `lib/` files

Target: No page component exceeds 300 lines.

---

## Medium Priority

### 6. Add Graceful Shutdown Handling

**Problem:** No cleanup on `SIGTERM`/`SIGINT`. This means:
- Active database connections are not drained
- In-flight requests are aborted
- Cron jobs may leave work in an inconsistent state

**Recommendation:**

```typescript
// server/index.ts
const server = app.listen(PORT);

async function shutdown(signal: string) {
  serverLogger.info(`Received ${signal}, shutting down gracefully`);
  server.close(() => {
    serverLogger.info("HTTP server closed");
  });
  // Close DB pool, Redis connections, cancel cron jobs
  await db.$client.end();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

---

### 7. Add End-to-End and External API Mock Tests

**Problem:** Current tests cover unit and basic API integration, but miss:
- Real database interaction tests (Drizzle + PostgreSQL)
- External API failure scenarios (ESPN down, rate-limited, malformed response)
- WebSocket connection tests
- Parlay correlation calculation edge cases

**Recommendation:**
- Use `testcontainers` to spin up a real PostgreSQL instance in CI
- Mock external APIs with `msw` (Mock Service Worker) to simulate failures, timeouts, and malformed data
- Add WebSocket integration tests for the line watcher

```typescript
// Example: MSW handler for ESPN failure
import { http, HttpResponse } from "msw";

const handlers = [
  http.get("https://site.api.espn.com/*", () => {
    return HttpResponse.json({ error: "Service unavailable" }, { status: 503 });
  }),
];
```

---

### 8. Add Pagination to All List Endpoints

**Problem:** Several endpoints return unbounded result sets. As the database grows, this will cause:
- Slow queries
- High memory usage
- Poor frontend performance

**Endpoints lacking pagination:**
- `GET /api/players` — returns all players
- `GET /api/bets` — returns all bets
- `GET /api/projections` — returns all projections
- `GET /api/track-record` — returns full history

**Recommendation:** Add cursor-based or offset pagination:

```typescript
// Standardized pagination schema
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Response format
interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

---

### 9. Harden Python Subprocess Integration

**Problem:** The Python ML model integration (`server/nba-prop-model/`) uses `child_process.spawn` with:
- Platform-specific Python binary paths (Windows vs. Linux)
- No execution timeouts
- Limited error output capture
- No structured output parsing

**Recommendation:**

```typescript
import { spawn } from "child_process";

function runPythonModel(script: string, args: string[], timeoutMs = 60_000): Promise<ModelResult> {
  return new Promise((resolve, reject) => {
    const pythonBin = process.env.PYTHON_BIN || "python3";
    const proc = spawn(pythonBin, [script, ...args], {
      cwd: path.join(__dirname, "nba-prop-model"),
      timeout: timeoutMs,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) {
        modelLogger.error("Python model failed", { script, code, stderr });
        return reject(new AppError(`Model execution failed: ${stderr}`, 500));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new AppError("Failed to parse model output", 500));
      }
    });

    proc.on("error", (err) => reject(new AppError(`Failed to spawn Python: ${err.message}`, 500)));
  });
}
```

Add `PYTHON_BIN` to `.env.example` to remove platform guessing.

---

### 10. Add Health Check Depth Levels

**Problem:** The current `/health` endpoint returns a simple 200 OK. This is fine for container orchestration liveness probes, but gives no visibility into dependency health.

**Recommendation:** Add a deep health check:

```typescript
app.get("/health", async (req, res) => {
  const deep = req.query.deep === "true";

  const status: Record<string, string> = { server: "ok" };

  if (deep) {
    // Check database
    try {
      await db.execute(sql`SELECT 1`);
      status.database = "ok";
    } catch {
      status.database = "error";
    }

    // Check Redis (if configured)
    try {
      await redis.ping();
      status.redis = "ok";
    } catch {
      status.redis = "error";
    }

    // Check external APIs (cached, don't actually call)
    status.espn = espnCircuitBreaker.state; // "closed" | "open" | "half-open"
    status.oddsApi = oddsCircuitBreaker.state;
  }

  const healthy = Object.values(status).every((s) => s === "ok" || s === "closed");
  res.status(healthy ? 200 : 503).json({ status, timestamp: new Date().toISOString() });
});
```

---

## Low Priority (Quality of Life)

### 11. Add Database Connection Pool Monitoring

**Problem:** No visibility into database pool utilization (idle connections, waiting queries, pool exhaustion).

**Recommendation:** Expose pool stats via the health endpoint or a `/metrics` endpoint:

```typescript
const pool = new Pool({
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Expose stats
app.get("/metrics/db", (req, res) => {
  res.json({
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  });
});
```

---

### 12. Add Client-Side Error Boundary and Reporting

**Problem:** If a React component crashes, the entire app shows a white screen with no user feedback and no server-side visibility.

**Recommendation:**
- Add React error boundaries around each page/route
- Report errors to the server via a `POST /api/client-errors` endpoint
- Display a user-friendly fallback UI

```tsx
<ErrorBoundary fallback={<ErrorFallback />} onError={reportToServer}>
  <Routes>
    <Route path="/bets" element={<BetsPage />} />
    ...
  </Routes>
</ErrorBoundary>
```

---

### 13. Address npm Audit Vulnerabilities

**Current state:** `npm audit` reports 3 high and 6 moderate vulnerabilities across 745 packages.

**Recommendation:**
- Run `npm audit fix` for auto-fixable issues
- For remaining issues, evaluate whether they affect runtime or are dev-only
- Pin known-good versions for high-severity packages
- Add `npm audit --audit-level=high` as a CI gate that fails the build

---

### 14. Add Pre-commit Hooks with Husky

**Problem:** No automated checks before code is committed. Developers can push code that fails linting, type checking, or has formatting issues.

**Recommendation:**

```bash
npx husky init
npx husky add .husky/pre-commit "npx lint-staged"
```

```json
// package.json
"lint-staged": {
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md}": ["prettier --write"]
}
```

---

### 15. Add Performance Monitoring for Slow Endpoints

**Problem:** No visibility into which endpoints are slow or degrading over time.

**Recommendation:** Add response time logging middleware and flag slow endpoints:

```typescript
app.use((req, res, next) => {
  const start = performance.now();
  res.on("finish", () => {
    const duration = performance.now() - start;
    const level = duration > 2000 ? "warn" : duration > 500 ? "info" : "debug";
    apiLogger[level](`${req.method} ${req.path}`, {
      duration: Math.round(duration),
      status: res.statusCode,
      requestId: req.id,
    });
  });
  next();
});
```

---

### 16. Improve Scraper Resilience

**Problem:** The PrizePicks scraper (`server/scraper/`) has complex proxy and user-agent rotation, but:
- No backoff on repeated failures from the same proxy
- No metrics on scraper success/failure rates
- No alerting when scrape success rate drops

**Recommendation:**
- Track per-proxy success/failure counts and disable failing proxies temporarily
- Log scrape success rate over rolling windows
- Add a `/metrics/scraper` endpoint for monitoring

---

## Security Improvements

### 17. Enforce HTTPS in Production

**Problem:** No automatic HTTP-to-HTTPS redirect in production.

```typescript
if (process.env.NODE_ENV === "production") {
  app.use((req, res, next) => {
    if (req.headers["x-forwarded-proto"] !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}
```

---

### 18. Add Content Security Policy Headers

**Problem:** Missing CSP headers. The existing security headers (`X-Frame-Options`, `X-Content-Type-Options`) are good but CSP provides defense-in-depth against XSS.

```typescript
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://site.api.espn.com https://api.the-odds-api.com"
  );
  next();
});
```

---

### 19. Audit `dangerouslySetInnerHTML` Usage

**Location:** `client/src/components/ui/chart.tsx`

Verify that the content passed to `dangerouslySetInnerHTML` is generated entirely by the application and never includes user-controlled input. If it does, sanitize with a library like `dompurify` before rendering.

---

## Implementation Roadmap

### Phase 1: Resilience and Observability
- [ ] Add circuit breakers for external APIs (#1)
- [ ] Add request correlation IDs (#2)
- [ ] Migrate cache to Redis (#3)
- [ ] Add graceful shutdown (#6)
- [ ] Add deep health checks (#10)

### Phase 2: Code Quality and Maintainability
- [ ] Complete routes.ts refactoring (#4)
- [ ] Refactor large page components (#5)
- [ ] Harden Python subprocess integration (#9)
- [ ] Add pre-commit hooks (#14)

### Phase 3: Testing and Performance
- [ ] Add E2E and external API mock tests (#7)
- [ ] Add pagination to list endpoints (#8)
- [ ] Add performance monitoring (#15)
- [ ] Improve scraper resilience (#16)

### Phase 4: Security and Polish
- [ ] Fix npm audit vulnerabilities (#13)
- [ ] Enforce HTTPS (#17)
- [ ] Add CSP headers (#18)
- [ ] Audit dangerouslySetInnerHTML (#19)
- [ ] Add DB pool monitoring (#11)
- [ ] Add client-side error boundaries (#12)

---

## File Metrics Reference

| File | Lines | Priority | Action |
|------|-------|----------|--------|
| `server/routes.ts` | 2,461 | HIGH | Complete migration to `server/routes/` |
| `client/src/pages/bets.tsx` | 966 | HIGH | Extract hooks + sub-components |
| `client/src/pages/team-stats.tsx` | 894 | MEDIUM | Split chart sections |
| `server/espn-api.ts` | 820 | MEDIUM | Add circuit breaker + timeouts |
| `client/src/pages/my-bets.tsx` | 618 | MEDIUM | Extract parsing logic |
| `client/src/pages/projections.tsx` | 577 | LOW | Separate concerns |

---

*Updated: 2026-01-29*
