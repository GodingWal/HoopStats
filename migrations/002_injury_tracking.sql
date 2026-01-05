-- Migration: Add injury tracking tables
-- Description: Creates tables for real-time injury monitoring and projection adjustments

-- Current player injuries (real-time state)
CREATE TABLE IF NOT EXISTS player_injuries (
    id SERIAL PRIMARY KEY,

    -- Player identification
    player_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,
    team_id INTEGER,

    -- Injury details
    status VARCHAR(20) NOT NULL, -- 'out', 'doubtful', 'questionable', 'probable', 'available', 'day-to-day', 'suspended'
    injury_type TEXT,
    description TEXT,
    return_date DATE,

    -- Source tracking
    source VARCHAR(50) NOT NULL, -- 'espn', 'rotowire', 'twitter', 'team_official'
    source_url TEXT,

    -- Timestamps
    first_reported TIMESTAMP DEFAULT NOW() NOT NULL,
    last_updated TIMESTAMP DEFAULT NOW() NOT NULL,
    status_changed_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Active flag
    is_active BOOLEAN DEFAULT TRUE
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_player_injuries_player_id ON player_injuries(player_id);
CREATE INDEX IF NOT EXISTS idx_player_injuries_team ON player_injuries(team);
CREATE INDEX IF NOT EXISTS idx_player_injuries_status ON player_injuries(status);
CREATE INDEX IF NOT EXISTS idx_player_injuries_active ON player_injuries(is_active);

-- Injury status change history
CREATE TABLE IF NOT EXISTS injury_history (
    id SERIAL PRIMARY KEY,

    -- Reference to player
    player_id INTEGER NOT NULL,
    player_name TEXT NOT NULL,
    team TEXT NOT NULL,

    -- Status change
    previous_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    injury_type TEXT,
    description TEXT,

    -- Source
    source VARCHAR(50) NOT NULL,

    -- When detected
    detected_at TIMESTAMP DEFAULT NOW() NOT NULL,

    -- Was this change significant for betting
    is_significant BOOLEAN DEFAULT FALSE
);

-- Index for history lookups
CREATE INDEX IF NOT EXISTS idx_injury_history_player_id ON injury_history(player_id);
CREATE INDEX IF NOT EXISTS idx_injury_history_detected_at ON injury_history(detected_at);
CREATE INDEX IF NOT EXISTS idx_injury_history_significant ON injury_history(is_significant);

-- Injury impact on teammates
CREATE TABLE IF NOT EXISTS injury_impacts (
    id SERIAL PRIMARY KEY,

    -- Injured player
    injured_player_id INTEGER NOT NULL,
    injured_player_name TEXT NOT NULL,
    injured_player_team TEXT NOT NULL,

    -- Benefiting player
    beneficiary_player_id INTEGER NOT NULL,
    beneficiary_player_name TEXT NOT NULL,

    -- Game context
    game_id VARCHAR(20),
    game_date DATE NOT NULL,
    opponent TEXT,

    -- Projection changes
    stat VARCHAR(20) NOT NULL,
    baseline_mean REAL NOT NULL,
    adjusted_mean REAL NOT NULL,
    baseline_std REAL NOT NULL,
    adjusted_std REAL NOT NULL,

    -- Edge changes
    current_line REAL,
    baseline_prob_over REAL,
    adjusted_prob_over REAL,
    edge_change REAL,

    -- Opportunity flag
    is_opportunity BOOLEAN DEFAULT FALSE,

    -- Timestamps
    calculated_at TIMESTAMP DEFAULT NOW() NOT NULL
);

-- Index for impact lookups
CREATE INDEX IF NOT EXISTS idx_injury_impacts_injured_player ON injury_impacts(injured_player_id);
CREATE INDEX IF NOT EXISTS idx_injury_impacts_beneficiary ON injury_impacts(beneficiary_player_id);
CREATE INDEX IF NOT EXISTS idx_injury_impacts_game_date ON injury_impacts(game_date);
CREATE INDEX IF NOT EXISTS idx_injury_impacts_opportunity ON injury_impacts(is_opportunity);

-- Comments
COMMENT ON TABLE player_injuries IS 'Current injury status for NBA players - updated in real-time';
COMMENT ON TABLE injury_history IS 'Historical record of all injury status changes for analysis';
COMMENT ON TABLE injury_impacts IS 'Calculated projection changes for teammates when players are out';
