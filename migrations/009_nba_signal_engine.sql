-- Migration 009: NBA Signal Engine Tables
-- Advanced player stats, team stats, signal results, weight registry, projection outputs

-- 1. Advanced player stats per game
CREATE TABLE IF NOT EXISTS player_advanced_stats (
    player_id VARCHAR(20) REFERENCES players(id),
    game_date DATE,
    usage_rate DECIMAL(5,2),
    ts_pct DECIMAL(5,3),
    rebound_rate DECIMAL(5,2),
    assist_rate DECIMAL(5,2),
    minutes INTEGER,
    pace DECIMAL(5,1),
    opp_def_rating DECIMAL(5,1),
    opp_pace DECIMAL(5,1),
    PRIMARY KEY (player_id, game_date)
);

-- 2. Team stats with positional defense splits
CREATE TABLE IF NOT EXISTS team_stats (
    team_id VARCHAR(10),
    season VARCHAR(10),
    pace DECIMAL(5,1),
    off_rating DECIMAL(5,1),
    def_rating DECIMAL(5,1),
    def_vs_pg DECIMAL(5,1),
    def_vs_sg DECIMAL(5,1),
    def_vs_sf DECIMAL(5,1),
    def_vs_pf DECIMAL(5,1),
    def_vs_c DECIMAL(5,1),
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (team_id, season)
);

-- 3. Signal outcomes for backtesting
CREATE TABLE IF NOT EXISTS signal_results (
    id SERIAL PRIMARY KEY,
    signal_type VARCHAR(50),
    signal_strength VARCHAR(20),
    player_id VARCHAR(20),
    game_date DATE,
    prop_type VARCHAR(30),
    model_projection DECIMAL(6,2),
    prizepicks_line DECIMAL(6,2),
    edge_pct DECIMAL(5,2),
    direction VARCHAR(10),
    outcome BOOLEAN,
    clv DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Bayesian weight registry
CREATE TABLE IF NOT EXISTS weight_registry (
    signal_type VARCHAR(50) PRIMARY KEY,
    weight DECIMAL(5,4),
    hit_rate DECIMAL(5,4),
    clv_rate DECIMAL(5,4),
    sample_size INTEGER,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. Final projection outputs
CREATE TABLE IF NOT EXISTS projection_outputs (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(20),
    game_date DATE,
    prop_type VARCHAR(30),
    baseline_projection DECIMAL(6,2),
    signal_delta DECIMAL(6,2),
    final_projection DECIMAL(6,2),
    prizepicks_line DECIMAL(6,2),
    edge_pct DECIMAL(5,2),
    confidence_tier VARCHAR(10),
    kelly_stake DECIMAL(5,4),
    signals_fired JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_signal_results_type_date ON signal_results(signal_type, game_date);
CREATE INDEX IF NOT EXISTS idx_projection_outputs_date ON projection_outputs(game_date);
CREATE INDEX IF NOT EXISTS idx_player_advanced_stats_date ON player_advanced_stats(game_date);

-- Seed default weights for known signal types
INSERT INTO weight_registry (signal_type, weight, hit_rate, clv_rate, sample_size)
VALUES
    ('positional_defense', 0.5000, 0.5000, 0.5000, 0),
    ('rest_days',          0.5000, 0.5000, 0.5000, 0),
    ('usage_redistribution', 0.5000, 0.5000, 0.5000, 0),
    ('ref_foul',           0.5000, 0.5000, 0.5000, 0),
    ('pace_matchup',       0.5000, 0.5000, 0.5000, 0),
    ('b2b_fatigue',        0.5000, 0.5000, 0.5000, 0),
    ('injury_alpha',       0.5000, 0.5000, 0.5000, 0)
ON CONFLICT (signal_type) DO NOTHING;
