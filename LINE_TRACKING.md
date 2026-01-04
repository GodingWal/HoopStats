# Line Tracking & Betting Data System

Comprehensive documentation for HoopStats' line tracking system - capturing, storing, and analyzing betting lines from all major sportsbooks.

## Overview

The line tracking system provides:
- **Complete Historical Data**: Every line from every sportsbook, timestamped
- **Line Movement Detection**: Automatic tracking of changes with significance flags
- **Best Line Identification**: Find the best available odds across all books
- **Vig Comparison**: See which books offer the lowest vig
- **User Bet Tracking**: Log your bets and calculate actual edge/ROI
- **Real-time Alerts**: Get notified of significant line movements

## Database Tables

### 1. `sportsbooks`
Tracks all betting operators.

```typescript
{
  id: number
  key: string              // 'fanduel', 'draftkings', 'bet365', etc.
  name: string             // Display name
  active: boolean          // Is this book still tracked?
  lastSync: timestamp      // Last time we polled this book
}
```

**Usage:** Maintain list of tracked sportsbooks. Deactivate books that go out of business.

### 2. `playerPropLines`
The core table - stores EVERY line from EVERY book.

```typescript
{
  id: number
  playerId: number
  playerName: string
  team: string
  gameId: string
  gameDate: date
  opponent: string

  stat: string             // 'points', 'rebounds', 'assists', 'threes', etc.
  line: number             // The actual line value (28.5, 8.5, etc.)

  sportsbookId: number     // Foreign key to sportsbooks table
  sportsbookKey: string    // Denormalized for quick queries

  overOdds: number         // American odds (-110, +105, etc.)
  underOdds: number

  overProb: number         // Implied probability from odds
  underProb: number
  totalProb: number        // Sum of probabilities (>1 due to vig)
  vig: number              // (totalProb - 1) / 2

  capturedAt: timestamp    // WHEN we captured this line
  isActive: boolean        // False if line removed/suspended
}
```

**Key Features:**
- Captures EVERY snapshot - never delete old data
- Timestamp shows exactly when line was available
- Implied probabilities calculated automatically
- Vig shows how much book is taking
- `isActive` lets you mark lines as removed without deleting history

**Query Examples:**
```typescript
// Get all current lines for Luka Doncic points
const lines = await storage.getPlayerPropLines(203999, 'points', '2026-01-15');

// Get latest snapshot (most recent poll)
const latest = await storage.getLatestLines(203999, 'points');

// Get all historical lines for analysis
const history = await storage.getPlayerPropLines(203999, 'points'); // No date = all time
```

### 3. `lineMovements`
Tracks when lines change.

```typescript
{
  id: number
  playerId: number
  playerName: string
  gameId: string
  stat: string
  sportsbookKey: string

  oldLine: number
  newLine: number
  lineChange: number       // newLine - oldLine

  oldOverOdds: number
  newOverOdds: number
  oldUnderOdds: number
  newUnderOdds: number

  direction: string        // 'up', 'down', 'odds_only'
  magnitude: number        // |lineChange|
  isSignificant: boolean   // True if magnitude >= 0.5 OR odds changed >= 20

  detectedAt: timestamp
  gameDate: date
}
```

**Significance Criteria:**
- Line moves >= 0.5 points
- OR odds change >= 20 (e.g., -110 to -130)

**Why This Matters:**
- Significant movements often indicate sharp money
- Track market reaction to news/injuries
- Identify value before books adjust

### 4. `bestLines`
Aggregated view of best available lines (updated on each poll).

```typescript
{
  id: number
  playerId: number
  playerName: string
  gameId: string
  gameDate: date
  stat: string

  bestOverLine: number      // Highest line available
  bestOverOdds: number      // Best odds for that line
  bestOverBook: string      // Which book has it

  bestUnderLine: number     // Lowest line available
  bestUnderOdds: number
  bestUnderBook: string

  consensusLine: number     // Average across all books
  numBooks: number          // How many books offer this prop
  lineSpread: number        // max - min (shows market agreement)

  lastUpdated: timestamp
}
```

**Line Shopping Value:**
- If you want OVER, find highest line with best odds
- If you want UNDER, find lowest line with best odds
- Large `lineSpread` = opportunity to shop around

### 5. `userBets`
Track your actual bets.

```typescript
{
  id: number
  playerId: number
  playerName: string
  gameId: string
  gameDate: date

  stat: string
  line: number
  side: string             // 'over' or 'under'

  sportsbookKey: string    // Where you placed it
  odds: number             // What odds you got
  stake: number            // How much you bet (in units)

  result: string           // 'win', 'loss', 'push', 'pending'
  actualValue: number      // Player's actual stat value
  profit: number           // Net profit/loss

  projectedProb: number    // YOUR model's probability
  impliedProb: number      // Book's implied probability
  edge: number             // projectedProb - impliedProb

  placedAt: timestamp      // When you placed the bet
  settledAt: timestamp     // When it was graded
  notes: text              // Optional notes
}
```

**Why Track This:**
- Calculate your ACTUAL ROI (not theoretical)
- See which edges convert to wins
- Track which sportsbooks give you the best lines
- Build verified track record
- Tax reporting

## API Endpoints

### Sportsbooks

**GET /api/sportsbooks**
```json
[
  {
    "id": 1,
    "key": "fanduel",
    "name": "FanDuel",
    "active": true,
    "lastSync": "2026-01-04T10:30:00Z"
  }
]
```

### Line Data

**GET /api/lines/player/:playerId?stat=points&gameDate=2026-01-15**

Get all lines for a player/stat/date.

```json
[
  {
    "id": 1234,
    "playerId": 203999,
    "playerName": "Luka Doncic",
    "stat": "points",
    "line": 28.5,
    "sportsbookKey": "fanduel",
    "overOdds": -110,
    "underOdds": -110,
    "overProb": 0.524,
    "underProb": 0.524,
    "vig": 0.024,
    "capturedAt": "2026-01-04T10:00:00Z"
  },
  {
    "sportsbookKey": "draftkings",
    "line": 29.5,
    // ...
  }
]
```

**GET /api/lines/latest/:playerId?stat=points**

Get the most recent snapshot (latest poll) across all books.

**GET /api/lines/compare/:playerId?stat=points&gameDate=2026-01-15**

Get formatted comparison showing best lines:

```json
{
  "playerId": 203999,
  "playerName": "Luka Doncic",
  "stat": "points",
  "gameDate": "2026-01-15",
  "lines": [
    {
      "sportsbook": "fanduel",
      "line": 28.5,
      "overOdds": -110,
      "underOdds": -110,
      "overImpliedProb": 0.524,
      "underImpliedProb": 0.524,
      "vig": 0.024
    },
    {
      "sportsbook": "draftkings",
      "line": 29.5,
      "overOdds": -115,
      "underOdds": -105,
      "overImpliedProb": 0.535,
      "underImpliedProb": 0.512,
      "vig": 0.0235
    }
  ],
  "bestOver": {
    "sportsbook": "draftkings",
    "line": 29.5,
    "odds": -115
  },
  "bestUnder": {
    "sportsbook": "fanduel",
    "line": 28.5,
    "odds": -110
  },
  "consensus": {
    "line": 29.0,
    "spread": 1.0
  }
}
```

**Interpretation:**
- If betting OVER, use DraftKings (higher line = easier to hit)
- If betting UNDER, use FanDuel (lower line = easier to hit)
- 1.0 point spread = decent line shopping opportunity

### Line Movements

**GET /api/lines/movements/:playerId?stat=points&gameDate=2026-01-15**

Get movement history for a specific player/stat.

**GET /api/lines/movements/recent?hours=24**

Get all significant movements in last N hours (default 24).

```json
[
  {
    "playerName": "Luka Doncic",
    "stat": "points",
    "sportsbookKey": "fanduel",
    "oldLine": 28.5,
    "newLine": 29.5,
    "lineChange": 1.0,
    "oldOverOdds": -110,
    "newOverOdds": -110,
    "direction": "up",
    "magnitude": 1.0,
    "isSignificant": true,
    "detectedAt": "2026-01-04T10:30:00Z"
  }
]
```

**Why This Matters:**
- Line moved up = sharp money on OVER (or injury to defensive player)
- Line moved down = sharp money on UNDER (or injury to scorer)
- Multiple books moving = market-wide adjustment
- One book moving = that book getting hit

### Best Lines

**GET /api/lines/best/:playerId?stat=points**

Get current best available lines.

**GET /api/lines/best/date/:gameDate**

Get best lines for all players on a date (useful for daily dashboard).

### User Bets

**POST /api/bets/user**
```json
{
  "playerId": 203999,
  "playerName": "Luka Doncic",
  "gameId": "401585136",
  "gameDate": "2026-01-15",
  "stat": "points",
  "line": 29.5,
  "side": "over",
  "sportsbookKey": "draftkings",
  "odds": -115,
  "stake": 1.0,
  "projectedProb": 0.607,
  "impliedProb": 0.535,
  "edge": 0.072,
  "notes": "Mavs vs weak defense, Luka's usage should be high"
}
```

**GET /api/bets/user?pending=true**

Get all pending (unsettled) bets.

**PATCH /api/bets/user/:betId**
```json
{
  "result": "win",
  "actualValue": 32,
  "profit": 0.87
}
```

Update bet result after game finishes.

## Line Tracking Service

### Usage

```typescript
import { lineTracker } from './server/line-tracker';

// Start tracking (polls every 5 minutes)
lineTracker.start(300000);

// Listen for significant movements
lineTracker.on('significant-movement', (data) => {
  console.log('Line moved:', data.playerName, data.movement.lineChange);
  // Send push notification, update dashboard, etc.
});

// Manually trigger a poll
await lineTracker.pollNow();

// Stop tracking
lineTracker.stop();
```

### How It Works

1. **Poll** - Every N minutes, fetch lines from all sportsbooks
2. **Store** - Save every line to `playerPropLines` table
3. **Compare** - Check against last known line for each player/stat/book
4. **Detect** - If line changed, create entry in `lineMovements`
5. **Update** - Recalculate best available lines
6. **Alert** - Emit event for significant movements

### Customization

```typescript
// Poll more frequently during prime betting hours
const now = new Date();
const hour = now.getHours();

if (hour >= 10 && hour <= 22) {
  lineTracker.start(60000); // Every minute
} else {
  lineTracker.start(600000); // Every 10 minutes
}
```

## Frontend Components

### LineComparison

Shows all available lines from all sportsbooks.

```tsx
import { LineComparison } from '@/components/line-comparison';

<LineComparison
  playerName="Luka Doncic"
  stat="points"
  lines={lineData.lines}
  bestOver={lineData.bestOver}
  bestUnder={lineData.bestUnder}
  consensus={lineData.consensus}
/>
```

**Features:**
- Table showing all books, lines, odds, vig
- Highlights best over and best under
- Shows implied probabilities
- Alerts if large spread exists

### LineMovementHistory

Visualizes line movements over time.

```tsx
import { LineMovementHistory } from '@/components/line-comparison';

<LineMovementHistory
  playerName="Luka Doncic"
  stat="points"
  movements={movementData}
/>
```

**Features:**
- Shows direction (up/down arrows)
- Highlights significant movements
- Timestamps all changes
- Color-coded by sportsbook

## Use Cases

### 1. Line Shopping

```typescript
// Get best available lines for today's games
const bestLines = await fetch('/api/lines/best/date/2026-01-15').then(r => r.json());

// Find best OVER for Luka points
const lukaLines = bestLines.find(l => l.playerId === 203999 && l.stat === 'points');
console.log(`Best over: ${lukaLines.bestOverLine} at ${lukaLines.bestOverOdds} (${lukaLines.bestOverBook})`);

// Savings: If FanDuel offers O28.5 -110 and DraftKings offers O29.5 -110,
// betting $100 on DraftKings saves you effectively 1 full point of value
```

### 2. Sharp Money Detection

```typescript
// Get recent significant movements
const movements = await fetch('/api/lines/movements/recent?hours=2').then(r => r.json());

// If line moved UP, sharps are hitting OVER
// If line moved DOWN, sharps are hitting UNDER
// Multiple books moving = stronger signal

movements.forEach(m => {
  if (m.magnitude >= 1.0) {
    console.log(`🚨 ${m.playerName} ${m.stat} moved ${m.lineChange} - Sharp action on ${m.direction.toUpperCase()}`);
  }
});
```

### 3. Track Your Bets

```typescript
// When placing a bet
const bet = await fetch('/api/bets/user', {
  method: 'POST',
  body: JSON.stringify({
    playerId: 203999,
    playerName: 'Luka Doncic',
    stat: 'points',
    line: 29.5,
    side: 'over',
    sportsbookKey: 'draftkings',
    odds: -115,
    stake: 2.0, // 2 units
    projectedProb: 0.607,
    impliedProb: 0.535,
    edge: 0.072 // 7.2% edge
  })
}).then(r => r.json());

// After game
await fetch(`/api/bets/user/${bet.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    result: 'win',
    actualValue: 32,
    profit: 1.74 // Won 2 units at -115 = 2 * (100/115) = 1.74
  })
});

// Calculate ROI
const myBets = await fetch('/api/bets/user').then(r => r.json());
const settledBets = myBets.filter(b => b.result !== 'pending');
const totalStaked = settledBets.reduce((sum, b) => sum + b.stake, 0);
const totalProfit = settledBets.reduce((sum, b) => sum + b.profit, 0);
const roi = (totalProfit / totalStaked) * 100;
console.log(`ROI: ${roi.toFixed(2)}%`);
```

### 4. Vig Shopping

```typescript
// Compare vig across books
const comparison = await fetch('/api/lines/compare/203999?stat=points&gameDate=2026-01-15').then(r => r.json());

// Sort by lowest vig
const lowestVig = comparison.lines.sort((a, b) => a.vig - b.vig)[0];
console.log(`Lowest vig: ${lowestVig.sportsbook} at ${(lowestVig.vig * 100).toFixed(2)}%`);

// Typical vig:
// - High vig: 4-5% (avoid these)
// - Standard: 2-3% (-110/-110)
// - Low vig: <2% (good value)
// - No vig: 0% (rare, promotional)
```

## Integration Checklist

To fully utilize the line tracking system:

- [ ] Configure odds API credentials (TheOddsAPI, DraftKings, etc.)
- [ ] Seed sportsbooks table with your tracked books
- [ ] Start lineTracker service in production
- [ ] Set up cron job or scheduled task for automatic polling
- [ ] Configure WebSocket for real-time updates (optional)
- [ ] Add line movement alerts to notification system
- [ ] Create dashboard showing best lines for today's games
- [ ] Build bet slip UI using line comparison data
- [ ] Add profit/loss charts from user bets
- [ ] Export bet history for tax reporting

## Performance Considerations

**Storage:**
- Lines accumulate rapidly (10 books × 100 players × 5 stats × 24 polls/day = 120k rows/day)
- Archive old data after 90 days to separate table
- Keep indexes on (playerId, stat, gameDate, capturedAt)

**Caching:**
- Cache latest lines in Redis (TTL: 5 minutes)
- Cache best lines (TTL: 1 minute)
- Use database for historical queries

**Rate Limiting:**
- Most odds APIs limit to 500 requests/month free tier
- Batch requests where possible
- Poll less frequently for low-volume games

## Compliance & Legal

**Disclaimers:**
- Line data for informational purposes only
- Verify lines directly with sportsbooks before betting
- User responsible for compliance with local gambling laws
- Track record does not guarantee future results

**Data Rights:**
- Lines are factual data (can be stored)
- Respect odds provider terms of service
- Do not redistribute raw odds data commercially
- Attribute data sources appropriately

## Next Steps

1. **Integrate Odds API**: Connect to TheOddsAPI or sportsbook APIs
2. **Real-time Updates**: Add WebSocket for live line changes
3. **Alerts**: Email/SMS for significant movements
4. **Bet Slip**: Build UI for placing tracked bets
5. **Analytics**: Identify which sportsbooks consistently have best lines
6. **Mobile**: Line shopping on the go
7. **Arbitrage**: Detect arbitrage opportunities across books
8. **Correlation**: Find correlated props for same-game parlays

Your line tracking system is now ready to capture EVERY line from EVERY book - giving you the data foundation for serious sports betting analytics.
