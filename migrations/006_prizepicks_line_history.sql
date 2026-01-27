-- Migration: Add PrizePicks Line History Tracking
-- Description: Creates tables for tracking historical PrizePicks lines and movements

-- PrizePicks line snapshots table
CREATE TABLE IF NOT EXISTS prizepicks_lines (
    id SERIAL PRIMARY KEY,

    -- PrizePicks-specific IDs
    prizepicks_id VARCHAR(50) NOT NULL,
    prizepicks_player_id VARCHAR(50) NOT NULL,

    -- Player info
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,
    team_abbr VARCHAR(10),
    position VARCHAR(10),

    -- Game info
    game_time TIMESTAMP NOT NULL,
    opponent TEXT,

    -- Line details
    stat_type VARCHAR(50) NOT NULL,
    stat_type_abbr VARCHAR(10),
    line REAL NOT NULL,

    -- Player image URL
    image_url TEXT,

    -- Metadata
    captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_player_id ON prizepicks_lines(prizepicks_player_id);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_player_name ON prizepicks_lines(player_name);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_stat_type ON prizepicks_lines(stat_type);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_game_time ON prizepicks_lines(game_time);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_captured_at ON prizepicks_lines(captured_at);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_active ON prizepicks_lines(is_active);
CREATE INDEX IF NOT EXISTS idx_prizepicks_lines_player_stat_game ON prizepicks_lines(prizepicks_player_id, stat_type, game_time);

-- PrizePicks line movements table
CREATE TABLE IF NOT EXISTS prizepicks_line_movements (
    id SERIAL PRIMARY KEY,

    -- Reference to player/stat
    prizepicks_player_id VARCHAR(50) NOT NULL,
    player_name TEXT NOT NULL,
    stat_type VARCHAR(50) NOT NULL,
    stat_type_abbr VARCHAR(10),

    -- Game context
    game_time TIMESTAMP NOT NULL,
    opponent TEXT,

    -- Line movement
    old_line REAL NOT NULL,
    new_line REAL NOT NULL,
    line_change REAL NOT NULL,

    -- Movement metadata
    direction VARCHAR(10) NOT NULL, -- 'up' or 'down'
    magnitude REAL NOT NULL,
    is_significant BOOLEAN NOT NULL, -- True if >= 0.5 movement

    -- Timestamps
    detected_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for movement queries
CREATE INDEX IF NOT EXISTS idx_prizepicks_movements_player_id ON prizepicks_line_movements(prizepicks_player_id);
CREATE INDEX IF NOT EXISTS idx_prizepicks_movements_player_name ON prizepicks_line_movements(player_name);
CREATE INDEX IF NOT EXISTS idx_prizepicks_movements_detected_at ON prizepicks_line_movements(detected_at);
CREATE INDEX IF NOT EXISTS idx_prizepicks_movements_significant ON prizepicks_line_movements(is_significant);
CREATE INDEX IF NOT EXISTS idx_prizepicks_movements_player_stat ON prizepicks_line_movements(prizepicks_player_id, stat_type, game_time);

-- Daily line aggregates table
CREATE TABLE IF NOT EXISTS prizepicks_daily_lines (
    id SERIAL PRIMARY KEY,

    -- Player/stat identification
    prizepicks_player_id VARCHAR(50) NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,
    stat_type VARCHAR(50) NOT NULL,
    stat_type_abbr VARCHAR(10),

    -- Date and game info
    game_date DATE NOT NULL,
    game_time TIMESTAMP NOT NULL,
    opponent TEXT,

    -- Opening and closing lines
    opening_line REAL NOT NULL,
    closing_line REAL,
    opening_captured_at TIMESTAMP NOT NULL,
    closing_captured_at TIMESTAMP,

    -- Line movement summary
    total_movement REAL DEFAULT 0,
    net_movement REAL DEFAULT 0,
    num_movements INTEGER DEFAULT 0,
    high_line REAL,
    low_line REAL,

    -- Outcome (filled after game)
    actual_value REAL,
    hit_over BOOLEAN,

    -- Metadata
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for daily lines
CREATE INDEX IF NOT EXISTS idx_prizepicks_daily_player_id ON prizepicks_daily_lines(prizepicks_player_id);
CREATE INDEX IF NOT EXISTS idx_prizepicks_daily_player_name ON prizepicks_daily_lines(player_name);
CREATE INDEX IF NOT EXISTS idx_prizepicks_daily_game_date ON prizepicks_daily_lines(game_date);
CREATE INDEX IF NOT EXISTS idx_prizepicks_daily_stat_type ON prizepicks_daily_lines(stat_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prizepicks_daily_unique ON prizepicks_daily_lines(prizepicks_player_id, stat_type, game_date);

-- Add comment for documentation
COMMENT ON TABLE prizepicks_lines IS 'Historical snapshots of PrizePicks lines captured at regular intervals';
COMMENT ON TABLE prizepicks_line_movements IS 'Records of line movements detected between polling intervals';
COMMENT ON TABLE prizepicks_daily_lines IS 'Aggregated daily line data with opening/closing lines and movement summaries';
