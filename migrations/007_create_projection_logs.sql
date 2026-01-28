-- Migration: Create Backtest Infrastructure Tables
-- Description: Creates tables for storing pre-game projections, signal weights, and performance tracking

-- ============================================================================
-- TABLE 1: projection_logs
-- Stores pre-game projections with all signal values for backtesting
-- ============================================================================
CREATE TABLE IF NOT EXISTS projection_logs (
    id SERIAL PRIMARY KEY,

    -- Game identification
    player_id VARCHAR(50) NOT NULL,
    player_name TEXT NOT NULL,
    game_id VARCHAR(50),
    game_date DATE NOT NULL,
    opponent VARCHAR(10),

    -- Prediction target
    stat_type VARCHAR(50) NOT NULL,  -- 'Points', 'Rebounds', 'Assists', '3-Pointers Made', etc.

    -- Market data
    prizepicks_line REAL,
    opening_line REAL,

    -- Our projection
    projected_value REAL NOT NULL,
    confidence_score REAL,  -- 0-1
    predicted_direction VARCHAR(10),  -- 'OVER' or 'UNDER'
    predicted_edge REAL,  -- projected_value - line

    -- Individual signal values (JSONB for flexibility)
    -- Example: {"b2b": -1.2, "pace": 0.8, "injury_alpha": 3.4, "home_away": 1.2}
    signals JSONB NOT NULL DEFAULT '{}',

    -- Signal metadata for debugging
    -- Example: {"is_b2b": true, "opponent_pace": 102.5, "injured_teammates": ["Giannis"]}
    signal_metadata JSONB DEFAULT '{}',

    -- Weights used at projection time
    -- Example: {"b2b": 0.12, "pace": 0.12, "injury_alpha": 0.20}
    weights_used JSONB DEFAULT '{}',

    -- Baseline value (before signal adjustments)
    baseline_value REAL,

    -- Actuals (filled post-game)
    actual_value REAL,
    actual_minutes REAL,
    hit_over BOOLEAN,
    projection_hit BOOLEAN,  -- Did our direction call hit?
    projection_error REAL,  -- actual - projected

    -- Timestamps
    captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
    game_completed_at TIMESTAMP,

    -- Unique constraint: one projection per player/game/stat
    UNIQUE(player_id, game_date, stat_type)
);

-- Indexes for projection_logs
CREATE INDEX IF NOT EXISTS idx_projection_logs_game_date ON projection_logs(game_date);
CREATE INDEX IF NOT EXISTS idx_projection_logs_stat_type ON projection_logs(stat_type);
CREATE INDEX IF NOT EXISTS idx_projection_logs_player_name ON projection_logs(player_name);
CREATE INDEX IF NOT EXISTS idx_projection_logs_needs_actuals ON projection_logs(game_date) WHERE actual_value IS NULL;
CREATE INDEX IF NOT EXISTS idx_projection_logs_signals ON projection_logs USING GIN (signals);
CREATE INDEX IF NOT EXISTS idx_projection_logs_captured_at ON projection_logs(captured_at);
CREATE INDEX IF NOT EXISTS idx_projection_logs_direction ON projection_logs(predicted_direction);


-- ============================================================================
-- TABLE 2: signal_weights
-- Stores learned weights per stat type with version history
-- ============================================================================
CREATE TABLE IF NOT EXISTS signal_weights (
    id SERIAL PRIMARY KEY,
    stat_type VARCHAR(50) NOT NULL,

    -- Weights with metadata
    -- Example: {
    --   "b2b": {"weight": 0.12, "accuracy": 0.66, "sample_size": 89},
    --   "pace": {"weight": 0.12, "accuracy": 0.55, "sample_size": 387},
    --   ...
    -- }
    weights JSONB NOT NULL,

    -- Validation metrics
    overall_accuracy REAL,
    sample_size INTEGER,
    validation_window_days INTEGER,

    -- Bayesian parameters used
    prior_strength INTEGER DEFAULT 30,  -- Equivalent sample size for prior

    -- Timestamps
    calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    valid_from DATE NOT NULL,
    valid_until DATE,  -- NULL = current active weights

    -- Only one active weight set per stat type at a time
    UNIQUE(stat_type, valid_from)
);

-- Indexes for signal_weights
CREATE INDEX IF NOT EXISTS idx_signal_weights_stat_type ON signal_weights(stat_type);
CREATE INDEX IF NOT EXISTS idx_signal_weights_active ON signal_weights(stat_type) WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_signal_weights_valid_from ON signal_weights(valid_from);


-- ============================================================================
-- TABLE 3: signal_performance
-- Daily tracking of individual signal accuracy for analysis
-- ============================================================================
CREATE TABLE IF NOT EXISTS signal_performance (
    id SERIAL PRIMARY KEY,
    signal_name VARCHAR(50) NOT NULL,
    stat_type VARCHAR(50) NOT NULL,
    evaluation_date DATE NOT NULL,

    -- Counts
    predictions_made INTEGER NOT NULL,
    correct_predictions INTEGER NOT NULL,
    accuracy REAL NOT NULL,

    -- By direction (when signal fired)
    over_predictions INTEGER DEFAULT 0,
    over_correct INTEGER DEFAULT 0,
    under_predictions INTEGER DEFAULT 0,
    under_correct INTEGER DEFAULT 0,

    -- Error metrics
    avg_error REAL,  -- Mean absolute error when signal fired
    avg_error_when_wrong REAL,  -- Average error when prediction was incorrect

    -- Rolling metrics (for trend analysis)
    rolling_7d_accuracy REAL,
    rolling_30d_accuracy REAL,

    -- Sample size requirement tracking
    min_sample_met BOOLEAN DEFAULT FALSE,  -- Did we meet minimum sample size?

    calculated_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Unique constraint: one record per signal/stat/date
    UNIQUE(signal_name, stat_type, evaluation_date)
);

-- Indexes for signal_performance
CREATE INDEX IF NOT EXISTS idx_signal_performance_date ON signal_performance(evaluation_date);
CREATE INDEX IF NOT EXISTS idx_signal_performance_signal ON signal_performance(signal_name, stat_type);
CREATE INDEX IF NOT EXISTS idx_signal_performance_accuracy ON signal_performance(accuracy);


-- ============================================================================
-- TABLE 4: backtest_runs
-- Track backtest execution history
-- ============================================================================
CREATE TABLE IF NOT EXISTS backtest_runs (
    id SERIAL PRIMARY KEY,

    -- Run configuration
    stat_type VARCHAR(50) NOT NULL,
    days_evaluated INTEGER NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    -- Overall results
    total_predictions INTEGER NOT NULL,
    correct_predictions INTEGER NOT NULL,
    overall_accuracy REAL NOT NULL,

    -- Per-signal breakdown (JSONB)
    -- Example: {"b2b": {"n": 89, "accuracy": 0.663}, "pace": {"n": 387, "accuracy": 0.553}}
    signal_breakdown JSONB NOT NULL DEFAULT '{}',

    -- Execution info
    run_started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    run_completed_at TIMESTAMP,

    notes TEXT
);

-- Index for backtest_runs
CREATE INDEX IF NOT EXISTS idx_backtest_runs_stat_type ON backtest_runs(stat_type);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_start_date ON backtest_runs(start_date);


-- Add comments for documentation
COMMENT ON TABLE projection_logs IS 'Pre-game projections with all signal values for backtesting. Actuals filled post-game.';
COMMENT ON TABLE signal_weights IS 'Learned weights per stat type with version history. valid_until=NULL indicates current weights.';
COMMENT ON TABLE signal_performance IS 'Daily tracking of individual signal accuracy against actual outcomes.';
COMMENT ON TABLE backtest_runs IS 'History of backtest runs with configuration and overall results.';

COMMENT ON COLUMN projection_logs.signals IS 'JSONB map of signal_name -> adjustment_value';
COMMENT ON COLUMN projection_logs.signal_metadata IS 'JSONB context data used for debugging (is_b2b, opponent_pace, etc.)';
COMMENT ON COLUMN signal_weights.weights IS 'JSONB map of signal_name -> {weight, accuracy, sample_size}';
COMMENT ON COLUMN signal_weights.valid_until IS 'NULL indicates this is the current active weight set';
