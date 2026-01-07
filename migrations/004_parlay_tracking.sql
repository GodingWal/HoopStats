-- Migration: Add parlay tracking tables for PrizePicks flex plays

-- Parlays table
CREATE TABLE IF NOT EXISTS parlays (
  id SERIAL PRIMARY KEY,
  parlay_type VARCHAR(20) NOT NULL CHECK (parlay_type IN ('flex', 'power')),
  num_picks INTEGER NOT NULL CHECK (num_picks >= 2 AND num_picks <= 6),
  entry_amount REAL NOT NULL CHECK (entry_amount > 0),
  payout_multiplier REAL NOT NULL CHECK (payout_multiplier > 0),
  result VARCHAR(10) CHECK (result IN ('win', 'loss', 'push', 'pending')),
  profit REAL,
  placed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMP,
  notes TEXT
);

-- Parlay picks table (individual picks within a parlay)
CREATE TABLE IF NOT EXISTS parlay_picks (
  id SERIAL PRIMARY KEY,
  parlay_id INTEGER NOT NULL REFERENCES parlays(id) ON DELETE CASCADE,
  player_id INTEGER,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  stat VARCHAR(20) NOT NULL,
  line REAL NOT NULL,
  side VARCHAR(10) NOT NULL CHECK (side IN ('over', 'under')),
  game_date DATE NOT NULL,
  result VARCHAR(10) CHECK (result IN ('hit', 'miss', 'push', 'pending')),
  actual_value REAL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_parlays_placed_at ON parlays(placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_parlays_result ON parlays(result);
CREATE INDEX IF NOT EXISTS idx_parlay_picks_parlay_id ON parlay_picks(parlay_id);
CREATE INDEX IF NOT EXISTS idx_parlay_picks_game_date ON parlay_picks(game_date);
