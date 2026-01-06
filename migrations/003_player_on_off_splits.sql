-- Migration: Add player on/off splits table
-- Description: Historical performance data for teammates when star players sit

-- Player on/off splits (historical WITH vs WITHOUT teammate performance)
CREATE TABLE IF NOT EXISTS player_on_off_splits (
    id SERIAL PRIMARY KEY,

    -- Player being analyzed (teammate who benefits/suffers)
    player_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    team VARCHAR(10) NOT NULL,

    -- Star player who was OUT
    without_player_id INTEGER NOT NULL,
    without_player_name TEXT NOT NULL,

    season VARCHAR(10) NOT NULL, -- e.g., '2024-25'

    -- Sample sizes
    games_with_teammate INTEGER NOT NULL,
    games_without_teammate INTEGER NOT NULL,

    -- Stats WITH teammate
    pts_with_teammate REAL,
    reb_with_teammate REAL,
    ast_with_teammate REAL,
    min_with_teammate REAL,
    fga_with_teammate REAL,

    -- Stats WITHOUT teammate
    pts_without_teammate REAL,
    reb_without_teammate REAL,
    ast_without_teammate REAL,
    min_without_teammate REAL,
    fga_without_teammate REAL,

    -- Deltas (precomputed for fast queries)
    pts_delta REAL,
    reb_delta REAL,
    ast_delta REAL,
    min_delta REAL,
    fga_delta REAL,

    -- Metadata
    calculated_at TIMESTAMP DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Unique constraint: one split per player pair per season
    UNIQUE(player_id, without_player_id, season)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_onoff_without_player ON player_on_off_splits(without_player_id, season);
CREATE INDEX IF NOT EXISTS idx_onoff_pair ON player_on_off_splits(player_id, without_player_id, season);
CREATE INDEX IF NOT EXISTS idx_onoff_team ON player_on_off_splits(team, season);
CREATE INDEX IF NOT EXISTS idx_onoff_updated ON player_on_off_splits(updated_at);

-- Comments
COMMENT ON TABLE player_on_off_splits IS 'Historical performance splits showing how players perform WITH vs WITHOUT teammates - used for prop betting when stars sit';
COMMENT ON COLUMN player_on_off_splits.player_id IS 'Player whose performance is being tracked';
COMMENT ON COLUMN player_on_off_splits.without_player_id IS 'Star player who was OUT (the injured/resting player)';
COMMENT ON COLUMN player_on_off_splits.games_without_teammate IS 'Sample size - minimum 3 required for statistical significance';
COMMENT ON COLUMN player_on_off_splits.pts_delta IS 'Change in PPG when star sits (positive = player benefits)';
