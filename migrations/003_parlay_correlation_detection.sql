-- Migration 003: Correlated Parlay Detection
-- Run in order. Do not drop existing tables.

-- 1. Pairwise player correlations cache (refresh weekly)
CREATE TABLE IF NOT EXISTS player_correlations (
    player_a_id VARCHAR(20),
    player_b_id VARCHAR(20),
    stat_type VARCHAR(20),         -- 'pts', 'reb', 'ast', 'pra', '3pm'
    correlation DECIMAL(5,3),      -- Pearson r, range -1.0 to 1.0
    p_value DECIMAL(6,4),
    sample_size INTEGER,
    confidence VARCHAR(10),        -- HIGH, MEDIUM, LOW, INSUFFICIENT
    relationship VARCHAR(25),      -- STRONG_POSITIVE, WEAK_POSITIVE, NEUTRAL, WEAK_NEGATIVE, STRONG_NEGATIVE
    same_team BOOLEAN,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (player_a_id, player_b_id, stat_type)
);

-- 2. Generated parlay recommendations with outcomes
CREATE TABLE IF NOT EXISTS parlay_results (
    id SERIAL PRIMARY KEY,
    legs JSONB,                    -- Array of {player_id, stat, line, projection, edge, hit_prob}
    correlations JSONB,            -- Array of {pair, correlation, relationship, ev_adjustment}
    parlay_type VARCHAR(25),       -- CORRELATED_POSITIVE, CORRELATED_NEGATIVE, INDEPENDENT
    parlay_template VARCHAR(30),   -- PACE_STACK, INJURY_STACK, DEFENSE_EXPLOIT, FADE_STACK
    leg_count INTEGER,
    base_hit_prob DECIMAL(5,4),    -- What PrizePicks assumes
    true_hit_prob DECIMAL(5,4),    -- Our correlation-adjusted estimate
    payout DECIMAL(5,2),
    combined_ev DECIMAL(5,4),
    recommendation VARCHAR(10),    -- SMASH, STRONG, LEAN, AVOID, SKIP
    avoid_reason TEXT,             -- Populated if AVOID
    outcome BOOLEAN,               -- NULL until settled
    payout_received DECIMAL(6,2),  -- NULL until settled
    game_date DATE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Game totals for pace context (if not already tracked)
CREATE TABLE IF NOT EXISTS game_context (
    game_id VARCHAR(30) PRIMARY KEY,
    game_date DATE,
    home_team_id VARCHAR(10),
    away_team_id VARCHAR(10),
    projected_total DECIMAL(5,1),  -- Over/under from sportsbooks
    actual_total INTEGER,          -- Populated post-game
    spread DECIMAL(4,1),           -- Positive = home favored
    is_b2b_home BOOLEAN,
    is_b2b_away BOOLEAN,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_player_correlations_a ON player_correlations(player_a_id, stat_type);
CREATE INDEX IF NOT EXISTS idx_player_correlations_b ON player_correlations(player_b_id, stat_type);
CREATE INDEX IF NOT EXISTS idx_parlay_results_date ON parlay_results(game_date);
CREATE INDEX IF NOT EXISTS idx_game_context_date ON game_context(game_date);
