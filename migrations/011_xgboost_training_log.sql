-- Migration: XGBoost Training Data Log
-- Description: Creates table for logging every bet with full feature vectors
--              and outcomes for XGBoost model training.
--
-- This is the foundation — without labeled data, no model can train.
-- Every prediction gets logged pre-game with features, then outcomes
-- are filled in post-game.

-- ============================================================================
-- TABLE: xgboost_training_log
-- Stores feature vectors at prediction time + post-game outcomes
-- ============================================================================
CREATE TABLE IF NOT EXISTS xgboost_training_log (
    id SERIAL PRIMARY KEY,

    -- Identification
    player_id VARCHAR(50) NOT NULL,
    game_date DATE NOT NULL,
    stat_type VARCHAR(50) NOT NULL,

    -- Market data
    line_value REAL NOT NULL,

    -- Full feature vector (JSONB — all 46 features from XGBoostFeatureBuilder)
    -- Example: {"edge_star_out": 10, "pace_differential": 4.4, "stdev_last_10": 3.2, ...}
    features JSONB NOT NULL DEFAULT '{}',

    -- Summary scores from existing system (for quick queries)
    signal_score REAL DEFAULT 0.0,
    edge_total REAL DEFAULT 0.0,
    predicted_direction VARCHAR(10),     -- 'OVER' or 'UNDER'
    confidence_tier VARCHAR(20),         -- 'SMASH', 'STRONG', 'LEAN', 'SKIP'

    -- Extra metadata (game context, injuries, etc.)
    metadata JSONB DEFAULT '{}',

    -- Post-game actuals (filled after game completes)
    actual_value REAL,
    actual_minutes REAL,
    hit BOOLEAN,                         -- actual > line (the XGBoost target)

    -- CLV data (filled at closing)
    closing_line REAL,
    closing_line_value REAL,             -- line_value - closing_line (positive = good)

    -- Timestamps
    captured_at TIMESTAMP NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMP,

    -- Unique constraint: one prediction per player/game/stat
    UNIQUE(player_id, game_date, stat_type)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Query patterns: training data retrieval, outcome filling, analytics

-- Training data queries (labeled rows, by stat type, date range)
CREATE INDEX IF NOT EXISTS idx_xgb_log_labeled
    ON xgboost_training_log(game_date)
    WHERE actual_value IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_xgb_log_stat_type
    ON xgboost_training_log(stat_type);

CREATE INDEX IF NOT EXISTS idx_xgb_log_stat_date
    ON xgboost_training_log(stat_type, game_date);

-- Unsettled predictions (for post-game update)
CREATE INDEX IF NOT EXISTS idx_xgb_log_unsettled
    ON xgboost_training_log(game_date)
    WHERE actual_value IS NULL;

-- Player-level queries
CREATE INDEX IF NOT EXISTS idx_xgb_log_player
    ON xgboost_training_log(player_id, stat_type);

-- Feature vector search (GIN index for JSONB queries)
CREATE INDEX IF NOT EXISTS idx_xgb_log_features
    ON xgboost_training_log USING GIN (features);

-- Confidence tier analysis
CREATE INDEX IF NOT EXISTS idx_xgb_log_confidence
    ON xgboost_training_log(confidence_tier)
    WHERE actual_value IS NOT NULL;

-- Hit rate analysis
CREATE INDEX IF NOT EXISTS idx_xgb_log_hit
    ON xgboost_training_log(hit)
    WHERE hit IS NOT NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE xgboost_training_log IS
    'Full feature vectors + outcomes for XGBoost training. '
    'Predictions logged pre-game, outcomes filled post-game.';

COMMENT ON COLUMN xgboost_training_log.features IS
    'JSONB map of feature_name -> float value. '
    'Contains all 46 XGBoost features from XGBoostFeatureBuilder.';

COMMENT ON COLUMN xgboost_training_log.hit IS
    'Binary target for XGBoost: TRUE if actual > line, FALSE otherwise.';

COMMENT ON COLUMN xgboost_training_log.closing_line_value IS
    'CLV = line_value - closing_line. Positive means we got a better line than close.';
