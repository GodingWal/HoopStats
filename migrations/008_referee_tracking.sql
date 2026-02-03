-- Migration: Create Referee Tracking Tables
-- Description: Stores referee information and game assignments for foul tracking

-- ============================================================================
-- TABLE 1: referees
-- Stores individual referee details
-- ============================================================================
CREATE TABLE IF NOT EXISTS referees (
    id INTEGER PRIMARY KEY,  -- Using official NBA ID from stats
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    jersey_number TEXT,
    
    -- Foul stats (updated periodically)
    avg_fouls_per_game REAL,
    games_officiated INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 2: game_referees
-- Links referees to specific games
-- ============================================================================
CREATE TABLE IF NOT EXISTS game_referees (
    id SERIAL PRIMARY KEY,
    game_id VARCHAR(50) NOT NULL,
    referee_id INTEGER REFERENCES referees(id),
    game_date DATE NOT NULL,
    
    -- Unique constraint: A ref can't be assigned to the same game twice
    UNIQUE(game_id, referee_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_game_referees_game_id ON game_referees(game_id);
CREATE INDEX IF NOT EXISTS idx_game_referees_referee_id ON game_referees(referee_id);
CREATE INDEX IF NOT EXISTS idx_game_referees_date ON game_referees(game_date);

-- Comments
COMMENT ON TABLE referees IS 'NBA officials with optional foul stats';
COMMENT ON TABLE game_referees IS 'Mapping of officials to games';
