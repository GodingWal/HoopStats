# Database Setup Guide

## Overview

HoopStats uses PostgreSQL as its primary database with Drizzle ORM for schema management and migrations.

## Prerequisites

- PostgreSQL 14 or higher
- Node.js 18 or higher
- npm or yarn

## Quick Start

### 1. Install PostgreSQL

#### macOS (using Homebrew)
```bash
brew install postgresql@14
brew services start postgresql@14
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

#### Windows
Download and install from: https://www.postgresql.org/download/windows/

### 2. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database and user
CREATE DATABASE hoopstats;
CREATE USER hoopstats_user WITH ENCRYPTED PASSWORD 'your_secure_password';
GRANT ALL PRIVILEGES ON DATABASE hoopstats TO hoopstats_user;

# Connect to the database
\c hoopstats

# Grant schema permissions
GRANT ALL ON SCHEMA public TO hoopstats_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hoopstats_user;

# Exit psql
\q
```

### 3. Configure Environment Variables

Create a `.env` file in the project root:

```env
# Database Configuration
DATABASE_URL=postgresql://hoopstats_user:your_secure_password@localhost:5432/hoopstats

# Server Configuration
PORT=5000
NODE_ENV=development

# API Keys (Optional)
BALLDONTLIE_API_KEY=your_balldontlie_api_key
ODDS_API_KEY=your_odds_api_key
```

### 4. Run Database Migrations

```bash
# Push the schema to the database
npm run db:push

# Or use drizzle-kit directly
npx drizzle-kit push
```

## Database Schema

### Core Tables

#### `players`
Stores NBA player information and statistics.

| Column | Type | Description |
|--------|------|-------------|
| id | integer | Primary key (ESPN player ID) |
| name | varchar | Player full name |
| team | varchar | Team abbreviation |
| position | varchar | Player position |
| season_averages | jsonb | Season average stats |
| last_5_averages | jsonb | Last 5 games averages |
| last_10_averages | jsonb | Last 10 games averages |
| hit_rates | jsonb | Historical hit rates by line |
| splits | jsonb | Home/away, day/night splits |

#### `projections`
Model-generated projections for player props.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| player_id | integer | Foreign key to players |
| game_date | date | Game date |
| stat_type | varchar | PTS, REB, AST, etc. |
| projection | numeric | Projected value |
| std_dev | numeric | Standard deviation |
| actual_result | numeric | Actual game result (nullable) |

#### `potentialBets`
Generated betting recommendations.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| player_id | integer | Foreign key to players |
| stat_type | varchar | Stat type |
| line | numeric | Betting line |
| hit_rate | numeric | Historical hit rate |
| recommendation | varchar | OVER or UNDER |
| confidence | varchar | HIGH, MEDIUM, LOW |

#### `sportsbooks`
Supported sportsbooks for line tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| name | varchar | Sportsbook name |
| key | varchar | API key/identifier |
| active | boolean | Is actively tracked |

#### `playerPropLines`
Historical betting lines from all sportsbooks.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| player_id | integer | Foreign key to players |
| sportsbook_id | integer | Foreign key to sportsbooks |
| stat_type | varchar | Stat type |
| line | numeric | Line value |
| over_odds | integer | Over odds (American) |
| under_odds | integer | Under odds (American) |
| game_date | date | Game date |
| timestamp | timestamp | When line was captured |

#### `lineMovements`
Detected significant line movements.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| player_id | integer | Foreign key to players |
| sportsbook_id | integer | Foreign key to sportsbooks |
| stat_type | varchar | Stat type |
| old_line | numeric | Previous line |
| new_line | numeric | New line |
| movement | numeric | Size of movement |
| timestamp | timestamp | When detected |

#### `userBets`
User-placed bets for tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | serial | Primary key |
| player_id | integer | Foreign key to players |
| stat_type | varchar | Stat type |
| line | numeric | Bet line |
| position | varchar | OVER or UNDER |
| odds | integer | Odds (American) |
| stake | numeric | Amount wagered |
| result | varchar | WIN, LOSS, PUSH (nullable) |
| placed_at | timestamp | When bet was placed |

## Maintenance

### Backup Database

```bash
# Create a backup
pg_dump hoopstats > hoopstats_backup_$(date +%Y%m%d).sql

# Restore from backup
psql hoopstats < hoopstats_backup_20240115.sql
```

### Monitor Database Size

```sql
SELECT
    pg_size_pretty(pg_database_size('hoopstats')) as db_size;
```

### Clean Old Data

```sql
-- Remove player prop lines older than 30 days
DELETE FROM "playerPropLines"
WHERE game_date < CURRENT_DATE - INTERVAL '30 days';

-- Vacuum to reclaim space
VACUUM ANALYZE "playerPropLines";
```

## Troubleshooting

### Connection Issues

**Problem:** `ECONNREFUSED` error when connecting to database

**Solution:**
1. Check if PostgreSQL is running: `pg_isready`
2. Verify DATABASE_URL in `.env`
3. Check PostgreSQL logs: `tail -f /usr/local/var/log/postgres.log` (macOS)

### Permission Errors

**Problem:** `permission denied for schema public`

**Solution:**
```sql
GRANT ALL ON SCHEMA public TO hoopstats_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hoopstats_user;
```

### Migration Failures

**Problem:** Migration fails with constraint errors

**Solution:**
1. Drop all tables and start fresh (development only):
```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO hoopstats_user;
```

2. Then run migrations again:
```bash
npm run db:push
```

## Performance Optimization

### Recommended Indexes

The schema automatically creates indexes on:
- `players.id` (primary key)
- `playerPropLines.player_id`
- `playerPropLines.game_date`
- `playerPropLines.timestamp`

### Additional Indexes (Optional)

For high-traffic production use:

```sql
-- Index for line comparison queries
CREATE INDEX idx_lines_player_stat ON "playerPropLines"(player_id, stat_type, game_date);

-- Index for recent line movements
CREATE INDEX idx_movements_recent ON "lineMovements"(timestamp DESC);

-- Index for projection lookups
CREATE INDEX idx_projections_player_date ON projections(player_id, game_date);
```

### Connection Pooling

For production, configure connection pooling in your environment:

```env
DATABASE_URL=postgresql://user:password@host:5432/hoopstats?pool_timeout=30&max_connections=20
```

## Production Deployment

### Using Managed PostgreSQL

Recommended providers:
- **Neon** (https://neon.tech) - Serverless PostgreSQL
- **Supabase** (https://supabase.com) - Open source alternative
- **Railway** (https://railway.app) - Simple deployment
- **AWS RDS** - Enterprise-grade

### Environment Variables for Production

```env
DATABASE_URL=postgresql://user:password@prod-host:5432/hoopstats?sslmode=require
NODE_ENV=production
```

### Automated Backups

Set up automated backups using `pg_dump` with cron:

```bash
# Add to crontab (runs daily at 2 AM)
0 2 * * * pg_dump hoopstats | gzip > /backups/hoopstats_$(date +\%Y\%m\%d).sql.gz
```

## Schema Evolution

### Making Schema Changes

1. Update the schema in `shared/schema.ts`
2. Run `npm run db:push` to sync changes
3. Test thoroughly in development
4. Deploy to production with migration plan

### Adding New Tables

```typescript
// shared/schema.ts
export const newTable = pgTable("newTable", {
  id: serial("id").primaryKey(),
  // ... other columns
});
```

Then run:
```bash
npm run db:push
```

## Support

For issues or questions:
- Check existing issues: https://github.com/yourusername/hoopstats/issues
- Database schema reference: `shared/schema.ts`
- Drizzle ORM docs: https://orm.drizzle.team/
