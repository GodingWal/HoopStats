-- Migration: Add model probability, calibration method, and SHAP explanation columns
-- Description: Extends xgboost_training_log to store calibrated probability,
--              calibration method used, and SHAP top drivers for each prediction.

ALTER TABLE xgboost_training_log ADD COLUMN IF NOT EXISTS model_prob REAL;
ALTER TABLE xgboost_training_log ADD COLUMN IF NOT EXISTS calibration_method VARCHAR(20);
ALTER TABLE xgboost_training_log ADD COLUMN IF NOT EXISTS shap_top_drivers JSONB DEFAULT '[]';

-- Index for querying by calibration method
CREATE INDEX IF NOT EXISTS idx_xgb_log_calibration
    ON xgboost_training_log(calibration_method)
    WHERE calibration_method IS NOT NULL;

COMMENT ON COLUMN xgboost_training_log.model_prob IS
    'Calibrated model probability (prob_over). Used for Brier score and calibration analysis.';

COMMENT ON COLUMN xgboost_training_log.calibration_method IS
    'Calibration method used: isotonic or none.';

COMMENT ON COLUMN xgboost_training_log.shap_top_drivers IS
    'JSONB array of top SHAP drivers: [{feature, shap_value, feature_value, direction}].';
