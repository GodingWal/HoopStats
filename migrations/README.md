# Database Migrations

This directory contains database migration scripts for HoopStats.

## Migration Strategy

HoopStats uses **Drizzle Kit** for schema management. Instead of traditional step-by-step migrations, Drizzle uses a "push" strategy:

1. Define your schema in `shared/schema.ts`
2. Run `npm run db:push` to sync your database with the schema
3. Drizzle automatically detects changes and applies them

## Setup

### First Time Setup

```bash
# 1. Ensure PostgreSQL is running
pg_isready

# 2. Create the database (if not already created)
psql -c "CREATE DATABASE hoopstats;"

# 3. Set DATABASE_URL in .env
echo "DATABASE_URL=postgresql://user:password@localhost:5432/hoopstats" >> .env

# 4. Push the schema to your database
npm run db:push
```

## Manual Migration Scripts

While Drizzle handles most schema changes automatically, this directory can contain:

- **Initial setup scripts** - For seeding data
- **Data migrations** - For transforming existing data
- **Custom operations** - For complex schema changes

### Running Manual Scripts

```bash
# Execute a migration script
psql $DATABASE_URL -f migrations/001_seed_sportsbooks.sql
```

## Available Scripts

- `001_seed_sportsbooks.sql` - Populate sportsbooks table with initial data
- `setup.sql` - Complete database initialization script

## Best Practices

1. **Always backup before migrations**
   ```bash
   pg_dump hoopstats > backup_before_migration.sql
   ```

2. **Test in development first**
   ```bash
   # Test against development database
   DATABASE_URL=postgresql://localhost/hoopstats_dev npm run db:push
   ```

3. **Use transactions for data migrations**
   ```sql
   BEGIN;
   -- your migration here
   COMMIT;
   ```

4. **Document breaking changes** in git commit messages

## Troubleshooting

### Reset Database (Development Only)

```bash
# Drop and recreate database
psql postgres -c "DROP DATABASE IF EXISTS hoopstats;"
psql postgres -c "CREATE DATABASE hoopstats;"

# Push schema
npm run db:push

# Run seed scripts
psql $DATABASE_URL -f migrations/001_seed_sportsbooks.sql
```

### Check Schema Drift

```bash
# See what changes would be applied
npx drizzle-kit push --dry-run
```

## Production Migrations

For production environments:

1. **Always use a maintenance window**
2. **Create a backup** before any changes
3. **Test the migration** on a staging environment
4. **Have a rollback plan** ready
5. **Monitor** after deployment

Example production workflow:

```bash
# 1. Backup
pg_dump $PROD_DATABASE_URL > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. Apply migration
npm run db:push

# 3. Verify
psql $PROD_DATABASE_URL -c "SELECT COUNT(*) FROM players;"

# 4. If issues, rollback
psql $PROD_DATABASE_URL < backup_20240115_143000.sql
```
