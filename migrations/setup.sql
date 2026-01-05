-- Complete database setup script for HoopStats
-- This script creates the database, user, and grants necessary permissions

-- Note: Run this as a PostgreSQL superuser (e.g., postgres)
-- Usage: psql postgres -f migrations/setup.sql

-- Create database (if it doesn't exist)
SELECT 'CREATE DATABASE hoopstats'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hoopstats')\gexec

-- Create user (if doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hoopstats_user') THEN
    CREATE USER hoopstats_user WITH ENCRYPTED PASSWORD 'change_me_in_production';
  END IF;
END
$$;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE hoopstats TO hoopstats_user;

-- Connect to the database
\c hoopstats

-- Grant schema permissions
GRANT ALL ON SCHEMA public TO hoopstats_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hoopstats_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hoopstats_user;

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search

-- Print success message
\echo '✅ Database setup complete!'
\echo 'Next steps:'
\echo '1. Update DATABASE_URL in .env file'
\echo '2. Run: npm run db:push'
\echo '3. Run seed scripts: psql $DATABASE_URL -f migrations/001_seed_sportsbooks.sql'
