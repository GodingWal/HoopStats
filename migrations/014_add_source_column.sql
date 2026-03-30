-- Migration: Add source column to xgboost_training_log
-- Description: Distinguishes real settled outcomes from synthetic bootstrap data
--              so the training pipeline can weight real data 3x over synthetic.

ALTER TABLE xgboost_training_log
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'real';

-- Back-fill rows that were inserted by bootstrap_training_data (bootstrap flag)
-- Bootstrap rows have settled_at = captured_at (set to utcnow() simultaneously)
-- and no model_prob (which is only set when the bet engine logged a live prediction).
-- This heuristic marks existing bootstrap rows correctly; live predictions always
-- have model_prob set because xgboost-logger.ts populates it at capture time.
UPDATE xgboost_training_log
SET source = 'synthetic'
WHERE model_prob IS NULL
  AND actual_value IS NOT NULL
  AND settled_at IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (settled_at - captured_at))) < 5;

-- Index for fast filtering by source during training data queries
CREATE INDEX IF NOT EXISTS idx_xgb_log_source
    ON xgboost_training_log(source, stat_type)
    WHERE actual_value IS NOT NULL;

COMMENT ON COLUMN xgboost_training_log.source IS
    'Data source: ''real'' = actual settled game outcome; ''synthetic'' = bootstrapped from historical lines.';
