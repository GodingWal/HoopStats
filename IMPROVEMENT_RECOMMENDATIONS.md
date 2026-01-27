# Courtside Edge - Improvement Recommendations

This document outlines recommended improvements for the Courtside Edge codebase, organized by priority and category.

---

## Implementation Status

The following improvements have been **IMPLEMENTED**:

| Improvement | Status | Location |
|-------------|--------|----------|
| Remove duplicate route handler | DONE | `server/routes.ts` |
| Create constants file | DONE | `server/constants.ts` |
| Create validation utilities | DONE | `server/validation.ts` |
| Replace console.log with logger | DONE | All server files |
| Split routes into modules | DONE | `server/routes/` |
| Split storage into modules | DONE | `server/storage/` |
| Add rate limiting | DONE | `server/middleware.ts` |
| Add CORS configuration | DONE | `server/middleware.ts` |
| Split React components | DONE | `client/src/components/bets/` |
| Add transaction support | DONE | `server/storage/base.ts` |
| Add integration tests | DONE | `server/__tests__/api.integration.test.ts` |
| Add API documentation | DONE | `server/api-docs.ts` (accessible at `/api-docs`) |

---

## Executive Summary

The codebase is a well-structured Full-Stack TypeScript application with strong foundational patterns. The improvements above have been implemented to enhance maintainability, reliability, and scalability.

**Key Stats:**
- ~24,186 lines of code
- React 18 + Vite frontend, Express.js + PostgreSQL backend
- 60+ UI components, 63 API endpoints

**New Features:**
- API documentation at `/api-docs`
- Rate limiting (100 requests/15 min for general, 20/15 min for expensive endpoints)
- Modular route and storage architecture
- Transaction support for database operations

---

## Critical Issues (COMPLETED)

### 1. Duplicate Route Handler
**Location:** `server/routes.ts` lines 445-453 and 578-592

The `/api/bets/refresh` endpoint is defined twice. Only the second definition executes; the first is dead code.

**Fix:**
```typescript
// Remove the duplicate route at line 445-453
// Keep only one definition of app.post("/api/bets/refresh", ...)
```

### 2. Replace Console.log with Logger
**Affected Files:** 130+ occurrences across server files

Direct `console.log` calls make debugging difficult in production. Use the existing logger infrastructure.

**Current (problematic):**
```typescript
console.error("Error fetching bets:", error);
```

**Recommended:**
```typescript
import { apiLogger } from "./logger";
apiLogger.error("Error fetching bets", { error });
```

### 3. Missing Input Validation
**Location:** `server/routes.ts` - 25+ `parseInt` calls without validation

**Current (vulnerable):**
```typescript
const playerId = parseInt(req.params.playerId);
const days = parseInt(req.query.days as string) || 30;
```

**Recommended (use existing utilities from validation.ts):**
```typescript
import { validatePositiveInt } from "./validation";
const playerId = validatePositiveInt(req.params.playerId, "playerId");
```

### 4. Unhandled Error Cases
**Location:** `server/routes.ts` - 2 routes missing try/catch blocks

Add consistent error handling to all route handlers using the existing `AppError` class.

---

## High Priority Improvements

### 5. Split Monolithic Routes File
**Current State:** `server/routes.ts` has 2,211 lines with 63 endpoints

**Recommended Structure:**
```
server/
├── routes/
│   ├── index.ts          # Route aggregator
│   ├── players.ts        # Player-related endpoints
│   ├── bets.ts           # Betting endpoints
│   ├── projections.ts    # Projection endpoints
│   ├── live-games.ts     # Live game data
│   ├── track-record.ts   # Performance tracking
│   ├── admin.ts          # Admin endpoints
│   └── parlays.ts        # Parlay functionality
```

### 6. Refactor Storage Layer
**Current State:** `server/storage.ts` is 1,444 lines with 30+ methods (God Object anti-pattern)

**Recommended Structure:**
```
server/storage/
├── index.ts              # Storage aggregator
├── player-storage.ts     # Player CRUD operations
├── bet-storage.ts        # Bet operations
├── projection-storage.ts # Projection operations
├── parlay-storage.ts     # Parlay operations
└── base-storage.ts       # Shared utilities
```

### 7. Add Request Rate Limiting
**Missing:** No rate limiting on API endpoints

**Recommended:**
```typescript
import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);
```

### 8. Add Integration Tests
**Current Coverage:** Only unit tests exist

**Recommended Test Categories:**
- API endpoint integration tests
- Database transaction tests
- Error handling path tests
- Cache behavior tests

---

## Medium Priority Improvements

### 9. Extract Magic Numbers to Constants
**Location:** Various files

**Current:**
```typescript
const limitedBets = sortedBets.slice(0, 50);
if (rate >= 70) confidence = "HIGH";
```

**Recommended:**
```typescript
// constants.ts
export const BETTING_CONFIG = {
  MAX_BETS_DISPLAY: 50,
  CONFIDENCE_THRESHOLDS: {
    HIGH: 70,
    MEDIUM: 55,
    LOW: 0,
  },
} as const;
```

### 10. Improve Cache Strategy
**Current Issues:**
- In-memory cache only (lost on restart)
- No cache invalidation strategy
- Potential memory leaks

**Recommendations:**
- Consider Redis for production
- Implement LRU cache with size limits
- Add cache invalidation hooks on data updates

### 11. Split Large Components
**Affected Files:**
- `client/src/pages/bets.tsx` (1,080 lines) - Extract parser logic
- `client/src/pages/team-stats.tsx` (894 lines) - Split into smaller components
- `client/src/pages/projections.tsx` (577 lines) - Separate concerns

### 12. Add Database Transactions
**Missing:** No transaction handling for multi-step operations

**Recommended:**
```typescript
async function createBetWithTracking(betData: BetInput): Promise<Bet> {
  return await db.transaction(async (tx) => {
    const bet = await tx.insert(bets).values(betData).returning();
    await tx.insert(trackRecord).values({ betId: bet.id, ... });
    return bet;
  });
}
```

### 13. Add API Documentation
**Missing:** No OpenAPI/Swagger documentation

**Recommended:** Add swagger-jsdoc and swagger-ui-express

```typescript
/**
 * @openapi
 * /api/players:
 *   get:
 *     summary: Get all players
 *     responses:
 *       200:
 *         description: List of players
 */
```

---

## Low Priority Improvements (Nice to Have)

### 14. Add Structured Logging with Correlation IDs
Track requests across the system for debugging:

```typescript
app.use((req, res, next) => {
  req.correlationId = crypto.randomUUID();
  next();
});
```

### 15. Add CORS Configuration
**Missing:** Proper CORS setup for security

```typescript
import cors from "cors";

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5173"],
  credentials: true,
}));
```

### 16. Performance Optimizations
- Implement database query result limiting
- Add pagination to list endpoints
- Consider batching related queries
- Profile and optimize slow queries

### 17. Add Contribution Guidelines
Create a `CONTRIBUTING.md` with:
- Code style guide
- PR process
- Testing requirements
- Branch naming conventions

---

## Security Recommendations

### 18. Validate Request Bodies
Use Zod schemas consistently for all request bodies:

```typescript
const betSchema = z.object({
  player_name: z.string().min(1),
  prop: z.string().min(1),
  line: z.number().positive(),
  side: z.enum(["over", "under"]),
});

app.post("/api/bets", validateBody(betSchema), async (req, res) => {
  // req.body is now validated
});
```

### 19. Review dangerouslySetInnerHTML Usage
**Location:** `client/src/components/ui/chart.tsx`

Ensure content source is trusted or sanitize HTML before rendering.

### 20. Sanitize Error Messages
Don't expose internal error details in production:

```typescript
if (process.env.NODE_ENV === "production") {
  res.status(500).json({ error: "An unexpected error occurred" });
} else {
  res.status(500).json({ error: error.message, stack: error.stack });
}
```

---

## Implementation Roadmap

### Phase 1: Critical Fixes (1-2 days)
- [ ] Remove duplicate route handler
- [ ] Replace console.log with logger (server files)
- [ ] Add input validation to routes
- [ ] Add missing try/catch blocks

### Phase 2: Architecture Improvements (1 week)
- [ ] Split routes.ts into feature modules
- [ ] Refactor storage.ts into entity classes
- [ ] Add integration tests
- [ ] Implement rate limiting

### Phase 3: Quality Improvements (1 week)
- [ ] Extract magic numbers to constants
- [ ] Improve cache strategy
- [ ] Split large React components
- [ ] Add database transactions
- [ ] Add API documentation

### Phase 4: Polish (ongoing)
- [ ] Add structured logging
- [ ] Configure CORS properly
- [ ] Performance optimizations
- [ ] Documentation improvements

---

## File Metrics Reference

| File | Lines | Priority | Action |
|------|-------|----------|--------|
| `server/routes.ts` | 2,211 | HIGH | Split by feature |
| `server/storage.ts` | 1,444 | HIGH | Split by entity |
| `client/src/pages/bets.tsx` | 1,080 | MEDIUM | Extract parser |
| `client/src/pages/team-stats.tsx` | 894 | MEDIUM | Split components |
| `server/espn-api.ts` | 820 | LOW | Consider splitting |

---

## Conclusion

The codebase has strong fundamentals but is reaching a complexity threshold where refactoring will significantly improve developer productivity. Prioritize the critical fixes first, then tackle the architectural improvements before adding new features.

**Estimated Total Effort:** 2-3 weeks for comprehensive improvements

---

*Generated: 2026-01-27*
