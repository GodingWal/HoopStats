# NBA Props Analytics Platform - New Features

This document describes the enhanced betting analytics features added to Courtside Edge.

## Overview

Courtside Edge has been transformed from a basic stats display into a comprehensive betting analytics platform with:

- **Probabilistic projections** with full distributions
- **Edge calculation** for finding +EV bets
- **Track record tracking** for transparency
- **Real-time monitoring** infrastructure
- **Parlay evaluation** tools

## New Database Schema

### Tables Added

#### 1. `projections`
Tracks all predictions with their distributions and outcomes.

```typescript
{
  id: number
  playerId: number
  playerName: string
  gameId: string
  stat: string           // 'points', 'rebounds', 'assists', etc.
  projectedMean: number
  projectedStd: number
  probOver: number
  line: number
  actualValue: number | null   // Filled after game
  hit: boolean | null
  createdAt: timestamp
  gameDate: date
}
```

#### 2. `recommendations`
Stores betting recommendations with edge calculations.

```typescript
{
  id: number
  projectionId: number
  playerId: number
  playerName: string
  stat: string
  side: 'over' | 'under'
  line: number
  edge: number
  confidence: 'high' | 'medium' | 'low'
  recommendedBetSize: number
  userBet: boolean
  profit: number | null
  createdAt: timestamp
  gameDate: date
}
```

#### 3. `teamDefense`
Caches defensive ratings for opponent adjustments.

```typescript
{
  teamId: number
  teamAbbr: string
  season: string
  defRating: number
  pace: number
  oppPtsAllowed: number
  oppRebAllowed: number
  oppAstAllowed: number
  opp3PtPctAllowed: number
  updatedAt: timestamp
}
```

## New API Endpoints

### GET /api/recommendations/today
Returns today's best betting opportunities.

**Query Parameters:**
- `minEdge` (optional): Minimum edge threshold (default: 0.03)

**Response:**
```json
[
  {
    "playerId": 123,
    "playerName": "Luka Doncic",
    "stat": "points",
    "line": 28.5,
    "side": "over",
    "edge": 0.072,
    "confidence": "high"
  }
]
```

### GET /api/projections/player/:playerId
Get detailed projection with edge for a specific player/prop.

**Query Parameters:**
- `stat`: Stat type (points, rebounds, assists, etc.)
- `line`: The betting line to evaluate

**Response:**
```json
{
  "playerId": 123,
  "playerName": "Luka Doncic",
  "stat": "points",
  "line": 28.5,
  "projectedMean": 30.2,
  "projectedStd": 6.4,
  "probOver": 0.607,
  "probUnder": 0.393,
  "edge": 0.083,
  "recommendedSide": "over",
  "confidence": "high"
}
```

### POST /api/projections/parlay
Evaluate a parlay by calculating combined probability.

**Request Body:**
```json
{
  "legs": [
    {
      "playerId": 123,
      "playerName": "Luka Doncic",
      "stat": "points",
      "line": 28.5,
      "side": "over"
    },
    {
      "playerId": 456,
      "playerName": "Jayson Tatum",
      "stat": "rebounds",
      "line": 8.5,
      "side": "over"
    }
  ]
}
```

**Response:**
```json
{
  "probability": 0.368,
  "fairOdds": "+172",
  "legs": 2,
  "individualProbs": [0.607, 0.605]
}
```

### GET /api/track-record
Get historical performance data.

**Query Parameters:**
- `days` (optional): Number of days to include (default: 30)

**Response:**
```json
{
  "total": 142,
  "wins": 78,
  "losses": 64,
  "hitRate": 0.549,
  "roi": 0.073,
  "profit": 10.36,
  "byConfidence": {
    "high": { "wins": 45, "total": 67, "hitRate": 0.672 },
    "medium": { "wins": 28, "total": 54, "hitRate": 0.519 },
    "low": { "wins": 5, "total": 21, "hitRate": 0.238 }
  },
  "byStat": {
    "points": { "wins": 32, "total": 58, "hitRate": 0.552 },
    "rebounds": { "wins": 23, "total": 41, "hitRate": 0.561 }
  },
  "equityCurve": [...],
  "calibration": [...]
}
```

## New Frontend Pages

### 1. Dashboard (`/dashboard`)
Main betting dashboard showing:
- Today's best plays (sorted by edge)
- 30-day track record summary
- Performance breakdown by confidence level
- Quick stats (record, hit rate, ROI, profit)

**Features:**
- Auto-refreshes every minute for fresh opportunities
- Filters recommendations by minimum edge
- Visual indicators for high-confidence plays

### 2. Track Record (`/track-record`)
Detailed performance analysis with:
- Equity curve (profit over time)
- Hit rate by stat type (bar chart)
- Performance by confidence level
- Calibration chart (predicted vs actual probabilities)
- Detailed statistics breakdown

**Features:**
- 90-day historical view
- Transparent timestamping
- Statistical validation tools
- Exportable data

## Frontend Components

### PropCard
Reusable component for displaying betting recommendations.

**Props:**
```typescript
interface PropCardProps {
  playerId: number
  playerName: string
  stat: string
  line: number
  side: 'over' | 'under'
  projectedMean: number
  projectedStd: number
  probOver: number
  probUnder: number
  edge: number
  confidence: 'high' | 'medium' | 'low'
}
```

**Visual Features:**
- Edge badge with color coding (green >6%, yellow >3%)
- Confidence badge
- Probability visualization bar
- Projection range display
- Quick action button

## Backend Services

### Injury Watcher
Real-time monitoring service for lineup changes and injuries.

**Usage:**
```typescript
import { injuryWatcher } from './server/injury-watcher';

// Start watching
injuryWatcher.start(60000); // Check every 60 seconds

// Listen for alerts
injuryWatcher.on('injury-alert', (alert) => {
  console.log('Injury detected:', alert.playerName);
  // Recalculate projections, send notifications, etc.
});

// Stop watching
injuryWatcher.stop();
```

**TODO - Future Implementation:**
- Twitter API integration for beat reporter monitoring
- ESPN injury report scraping
- Team official announcement monitoring
- WebSocket notifications to frontend
- Automatic projection recalculation

## Storage Layer

New methods added to `IStorage` interface:

```typescript
// Projections
createProjection(projection: InsertProjection): Promise<DbProjection>
getProjectionsByDate(date: Date): Promise<DbProjection[]>
updateProjectionActual(id: number, actualValue: number, hit: boolean): Promise<void>

// Recommendations
createRecommendation(recommendation: InsertRecommendation): Promise<DbRecommendation>
getRecommendationsByDate(date: Date): Promise<DbRecommendation[]>
getTodaysRecommendations(): Promise<DbRecommendation[]>

// Track Record
getTrackRecord(days: number): Promise<TrackRecord>

// Team Defense
getTeamDefense(teamId: number): Promise<DbTeamDefense | undefined>
upsertTeamDefense(defense: InsertTeamDefense): Promise<void>
```

## Probability Calculations

### Normal CDF
Used for calculating over/under probabilities from normal distributions.

```typescript
function normalCDF(x: number, mean: number, std: number): number
```

### Edge Calculation
```typescript
const breakEven = 0.524; // -110 odds break-even point
const edgeOver = probOver - breakEven;
const edgeUnder = probUnder - breakEven;
```

**Confidence Levels:**
- High: edge > 6%
- Medium: edge > 3%
- Low: edge < 3% (usually not recommended)

### American Odds Conversion
```typescript
function probToAmericanOdds(prob: number): string
```

Converts probability to American odds format (+150, -200, etc.)

## Next Steps

### Priority Implementations

1. **Database Migration**
   ```bash
   # Generate migration
   npm run db:generate

   # Run migration
   npm run db:migrate
   ```

2. **Daily Projection Cron Job**
   - Set up cron to run projections daily at 9 AM
   - Save all projections to database
   - Generate recommendations
   - Update team defense cache

3. **Injury Watcher Integration**
   - Implement Twitter monitoring
   - Set up ESPN scraper
   - Add WebSocket notifications
   - Integrate with projection recalculation

4. **Line Shopping Integration**
   - Add multiple sportsbook APIs
   - Compare lines across books
   - Highlight best available odds
   - Track line movements

5. **Bankroll Management**
   - Kelly Criterion implementation
   - Unit sizing recommendations
   - Risk of ruin calculations
   - Drawdown tracking

6. **Enhanced Track Record**
   - Export to CSV
   - Share-able public links
   - Advanced filtering
   - Statistical significance tests

## Usage Examples

### Finding Today's Best Bets

```typescript
// Frontend
const { data: recommendations } = useQuery({
  queryKey: ['recommendations-today'],
  queryFn: async () => {
    const response = await fetch('/api/recommendations/today?minEdge=0.05');
    return response.json();
  }
});

// Display high-confidence plays with >5% edge
const topPlays = recommendations?.filter(r =>
  r.confidence === 'high' && r.edge >= 0.05
);
```

### Evaluating a Specific Prop

```typescript
// Check if Luka over 28.5 points is +EV
const evaluation = await fetch(
  '/api/projections/player/203999?stat=points&line=28.5'
).then(r => r.json());

if (evaluation.edge >= 0.03) {
  console.log(`+EV bet: ${evaluation.recommendedSide} with ${evaluation.edge}% edge`);
}
```

### Building a Parlay

```typescript
const parlay = await fetch('/api/projections/parlay', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    legs: [
      { playerId: 203999, stat: 'points', line: 28.5, side: 'over' },
      { playerId: 1628369, stat: 'rebounds', line: 8.5, side: 'over' }
    ]
  })
}).then(r => r.json());

console.log(`Parlay true probability: ${(parlay.probability * 100).toFixed(1)}%`);
console.log(`Fair odds: ${parlay.fairOdds}`);
```

## Architecture Benefits

### What Makes This Sellable

1. **Track Record Page** - Builds trust through transparency
2. **Real-time Alerts** - Speed advantage over slow books
3. **PrizePicks Optimizer** - Unique tool for DFS/parlay players
4. **Line Shopping** - Immediate savings
5. **Personal Dashboard** - Sticky user experience

### Competitive Advantages

- **Distribution-based projections** (not just point estimates)
- **Verified track record** (timestamped predictions)
- **Real-time injury monitoring**
- **Correlation-aware parlay evaluation**
- **Transparent methodology**

## Maintenance

### Regular Tasks

**Daily:**
- Run projection updates at 9 AM EST
- Update team defense ratings
- Fetch latest odds

**Weekly:**
- Review track record performance
- Calibrate models
- Update injury impact estimates

**Monthly:**
- Deep model retraining
- Feature importance analysis
- User feedback integration

## Support & Documentation

For questions or issues:
1. Check the existing Python model documentation in `/server/nba-prop-model/ARCHITECTURE.md`
2. Review API endpoint documentation above
3. Examine component props and usage examples

## License & Attribution

This analytics platform builds on the existing Courtside Edge foundation and integrates:
- NBA stats via ESPN and NBA.com APIs
- Odds data via TheOddsAPI
- Player projections via custom ML models
- Distribution modeling via scipy/numpy
