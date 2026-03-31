#!/usr/bin/env python3
"""
XGBoost Training Script

Trains XGBoost models per stat type using labeled data from xgboost_training_log.
Can also bootstrap training data from prizepicks_daily_lines + projection_logs
when xgboost_training_log is empty.

Usage:
    python scripts/train_xgboost.py                    # Train all stat types
    python scripts/train_xgboost.py --stat Points      # Train single stat
    python scripts/train_xgboost.py --bootstrap         # Bootstrap from historical data first
    python scripts/train_xgboost.py --dry-run           # Show data stats without training
"""

import os
import sys
import argparse
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL

from src.models.xgboost_model import XGBoostPropModel, HAS_XGBOOST, XGBOOST_FEATURE_NAMES
from src.evaluation.outcome_logger import OutcomeLogger
from src.features.xgboost_features import XGBoostFeatureBuilder
from config.settings import XGBoostConfig

# Optional: Optuna for hyperparameter tuning
try:
    import optuna
    HAS_OPTUNA = True
except ImportError:
    HAS_OPTUNA = False

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Stat types to train models for
TRAINABLE_STATS = ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Steals', 'Blocks', 'Turnovers']


def get_connection():
    return _shared_get_connection()



def get_training_stats(conn) -> Dict[str, Any]:
    """Get summary of available training data per stat type."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                stat_type,
                COUNT(*) as total,
                COUNT(actual_value) as labeled,
                COUNT(*) - COUNT(actual_value) as unlabeled,
                MIN(game_date) as earliest,
                MAX(game_date) as latest
            FROM xgboost_training_log
            GROUP BY stat_type
            ORDER BY labeled DESC
        """)
        rows = cursor.fetchall()
        cursor.close()

        stats = {}
        for row in rows:
            stats[row[0]] = {
                'total': row[1],
                'labeled': row[2],
                'unlabeled': row[3],
                'earliest': str(row[4]) if row[4] else None,
                'latest': str(row[5]) if row[5] else None,
            }
        return stats
    except Exception as e:
        logger.warning(f"Could not query training stats: {e}")
        return {}


def bootstrap_training_data(conn, stat_types: List[str] = None) -> int:
    """
    Bootstrap xgboost_training_log from prizepicks_daily_lines + projection_logs.

    Builds feature vectors from historical data where we have both
    the line and the actual outcome, then inserts into xgboost_training_log.
    """
    if stat_types is None:
        stat_types = TRAINABLE_STATS

    feature_builder = XGBoostFeatureBuilder(use_advanced=True)
    inserted = 0

    try:
        cursor = conn.cursor()

        # Get historical data with actuals from prizepicks_daily_lines
        cursor.execute("""
            SELECT DISTINCT
                pdl.prizepicks_player_id as player_id,
                pdl.player_name,
                pdl.team,
                pdl.stat_type,
                pdl.opening_line as line,
                pdl.actual_value,
                pdl.game_date,
                pdl.opponent,
                p.season_averages,
                p.last_5_averages,
                p.last_10_averages,
                p.home_averages,
                p.away_averages,
                p.position,
                p.recent_games,
                p.usage_rate,
                p.ts_pct
            FROM prizepicks_daily_lines pdl
            LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
            WHERE pdl.actual_value IS NOT NULL
              AND pdl.opening_line IS NOT NULL
              AND pdl.opening_line > 0
              AND pdl.stat_type = ANY(%s)
            ORDER BY pdl.game_date ASC
        """, (stat_types,))

        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]
        logger.info(f"Found {len(rows)} historical records to bootstrap from")

        for row in rows:
            data = dict(zip(columns, row))
            try:
                # Build context for feature extraction
                context = _build_context_from_row(data)

                # Build features
                fv = feature_builder.build(context)

                # Determine hit
                actual = float(data['actual_value'])
                line = float(data['line'])
                hit = actual > line

                # Insert into training log (tagged as synthetic bootstrap data)
                cursor.execute("""
                    INSERT INTO xgboost_training_log (
                        player_id, game_date, stat_type, line_value,
                        features, signal_score, edge_total,
                        predicted_direction, confidence_tier,
                        actual_value, hit, source, captured_at, settled_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (player_id, game_date, stat_type) DO NOTHING
                """, (
                    str(data.get('player_id', data['player_name'])),
                    data['game_date'],
                    data['stat_type'],
                    line,
                    json.dumps(fv.features),
                    0.0,  # signal_score placeholder
                    0.0,  # edge_total placeholder
                    'OVER' if actual > line else 'UNDER',
                    'LEAN',
                    actual,
                    hit,
                    'synthetic',  # bootstrap data — not a live prediction
                    datetime.utcnow(),
                    datetime.utcnow(),
                ))
                inserted += 1
            except Exception as e:
                logger.debug(f"Skipping row: {e}")
                continue

        conn.commit()
        cursor.close()
        logger.info(f"Bootstrapped {inserted} training records")
        return inserted

    except Exception as e:
        logger.error(f"Bootstrap failed: {e}")
        try:
            conn.rollback()
        except:
            pass
        return 0


def _build_context_from_row(data: Dict[str, Any]) -> Dict[str, Any]:
    """Build a feature context dict from a database row."""
    context = {
        'line': float(data.get('line', 0)),
        'stat_type': data.get('stat_type', ''),
        'player_name': data.get('player_name', ''),
        'team': data.get('team', ''),
        'opponent': data.get('opponent', ''),
        'game_date': str(data.get('game_date', '')),
    }

    # Parse JSON fields safely
    for key in ['season_averages', 'last_5_averages', 'last_10_averages',
                'home_averages', 'away_averages', 'recent_games']:
        val = data.get(key)
        if val is None:
            context[key] = {}
        elif isinstance(val, str):
            try:
                context[key] = json.loads(val)
            except:
                context[key] = {}
        elif isinstance(val, dict):
            context[key] = val
        else:
            context[key] = {}

    # Scalar fields
    if data.get('usage_rate'):
        context['usage_rate'] = float(data['usage_rate'])
    if data.get('ts_pct'):
        context['ts_pct'] = float(data['ts_pct'])
    if data.get('actual_value') is not None:
        context['actual_value'] = float(data['actual_value'])

    # Extract game logs from recent_games if available
    recent = context.get('recent_games', {})
    if isinstance(recent, list):
        context['game_logs'] = recent
    elif isinstance(recent, dict) and 'games' in recent:
        context['game_logs'] = recent['games']

    return context


def time_series_cv(
    training_data: List[Dict[str, Any]],
    stat_type: str,
    n_splits: int = 3,
    config: Optional[XGBoostConfig] = None,
) -> Dict[str, Any]:
    """
    Expanding-window time-series cross-validation.

    Fold 1: Train on first 50%, validate on next 16.7%
    Fold 2: Train on first 66.7%, validate on next 16.7%
    Fold 3: Train on first 83.3%, validate on last 16.7%

    Returns averaged metrics across folds.
    """
    if config is None:
        config = XGBoostConfig()

    n = len(training_data)
    fold_size = n // (n_splits + 1)

    if fold_size < 30:
        logger.warning(f"Too few samples for {n_splits}-fold CV: {n} samples, {fold_size}/fold")
        return {"error": "insufficient_data_for_cv", "n_samples": n}

    fold_metrics = []
    for fold_idx in range(n_splits):
        train_end = fold_size * (fold_idx + 1)
        val_end = min(train_end + fold_size, n)

        fold_train = training_data[:train_end]
        fold_val = training_data[train_end:val_end]

        if len(fold_val) < 10:
            continue

        model = XGBoostPropModel(
            n_estimators=config.n_estimators,
            max_depth=config.max_depth,
            learning_rate=config.learning_rate,
            min_child_weight=config.min_child_weight,
            subsample=config.subsample,
            colsample_bytree=config.colsample_bytree,
            reg_alpha=config.reg_alpha,
            reg_lambda=config.reg_lambda,
            early_stopping_rounds=config.early_stopping_rounds,
            use_calibration=config.use_calibration,
            sample_weight_halflife_days=config.sample_weight_halflife_days,
        )

        # Use the fold_val as both val split and full data (no further splitting)
        metrics = model.train(fold_train + fold_val, stat_type, validation_split=len(fold_val) / (len(fold_train) + len(fold_val)))

        if "error" not in metrics:
            fold_metrics.append(metrics)
            logger.info(
                f"  CV Fold {fold_idx+1}: acc={metrics.get('val_accuracy', 0):.4f}, "
                f"logloss={metrics.get('val_logloss', 0):.4f}, n_train={len(fold_train)}, n_val={len(fold_val)}"
            )

    if not fold_metrics:
        return {"error": "all_folds_failed"}

    # Average metrics across folds
    avg_metrics = {}
    for key in ["val_accuracy", "val_logloss", "val_brier"]:
        values = [m[key] for m in fold_metrics if key in m]
        if values:
            avg_metrics[f"cv_{key}_mean"] = float(np.mean(values))
            avg_metrics[f"cv_{key}_std"] = float(np.std(values))

    avg_metrics["cv_n_folds"] = len(fold_metrics)
    return avg_metrics


def tune_hyperparameters(
    training_data: List[Dict[str, Any]],
    stat_type: str,
    n_trials: int = 50,
) -> Dict[str, Any]:
    """
    Bayesian hyperparameter optimization using Optuna.
    Objective: minimize validation log loss via time-series CV.

    Returns best hyperparameters.
    """
    if not HAS_OPTUNA:
        logger.warning("Optuna not installed — skipping hyperparameter tuning")
        return {}

    if not HAS_XGBOOST:
        logger.warning("XGBoost not installed — skipping tuning")
        return {}

    import xgboost as xgb

    def objective(trial):
        params = {
            "max_depth": trial.suggest_int("max_depth", 3, 6),
            "n_estimators": trial.suggest_int("n_estimators", 100, 500, step=50),
            "learning_rate": trial.suggest_float("learning_rate", 0.01, 0.1, log=True),
            "min_child_weight": trial.suggest_int("min_child_weight", 3, 10),
            "subsample": trial.suggest_float("subsample", 0.6, 1.0),
            "colsample_bytree": trial.suggest_float("colsample_bytree", 0.6, 1.0),
            "reg_alpha": trial.suggest_float("reg_alpha", 0.01, 1.0, log=True),
            "reg_lambda": trial.suggest_float("reg_lambda", 0.1, 5.0, log=True),
        }

        # 2-fold time-series CV for speed
        n = len(training_data)
        fold_size = n // 3
        losses = []

        for fold in range(2):
            train_end = fold_size * (fold + 1)
            val_end = min(train_end + fold_size, n)

            train_d = training_data[:train_end]
            val_d = training_data[train_end:val_end]

            if len(val_d) < 10 or len(train_d) < 30:
                continue

            model = XGBoostPropModel(**params, early_stopping_rounds=15)
            metrics = model.train(train_d + val_d, stat_type,
                                  validation_split=len(val_d) / (len(train_d) + len(val_d)))

            if "val_logloss" in metrics:
                losses.append(metrics["val_logloss"])

        if not losses:
            return 1.0  # worst case
        return float(np.mean(losses))

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="minimize")
    study.optimize(objective, n_trials=n_trials, timeout=300)  # 5 min max

    best = study.best_params
    logger.info(f"Best hyperparameters for {stat_type}: {best}")
    logger.info(f"Best validation logloss: {study.best_value:.4f}")

    return best


def check_auto_retrain(conn, stat_type: str, threshold: int = 50) -> bool:
    """Check if enough new labeled data has arrived since last training."""
    try:
        cursor = conn.cursor()
        # Check for a training metadata record
        model_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "models", "xgboost",
        )
        meta_path = os.path.join(model_dir, f"{stat_type}_meta.json")

        last_train_date = None
        if os.path.exists(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
                last_train_date = meta.get("last_train_date")

        if last_train_date:
            cursor.execute("""
                SELECT COUNT(*) FROM xgboost_training_log
                WHERE stat_type = %s AND actual_value IS NOT NULL
                  AND settled_at > %s
            """, (stat_type, last_train_date))
        else:
            cursor.execute("""
                SELECT COUNT(*) FROM xgboost_training_log
                WHERE stat_type = %s AND actual_value IS NOT NULL
            """, (stat_type,))

        count = cursor.fetchone()[0]
        cursor.close()

        logger.info(f"Auto-retrain check for {stat_type}: {count} new samples (threshold: {threshold})")
        return count >= threshold
    except Exception as e:
        logger.warning(f"Auto-retrain check failed: {e}")
        return True  # Default to retrain if check fails


def save_training_metadata(stat_type: str, metrics: Dict[str, Any]) -> None:
    """Save training metadata for auto-retrain tracking."""
    model_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "xgboost",
    )
    os.makedirs(model_dir, exist_ok=True)
    meta_path = os.path.join(model_dir, f"{stat_type}_meta.json")

    meta = {
        "last_train_date": datetime.utcnow().isoformat(),
        "real_rows_at_last_train": metrics.get("n_real", 0),
        "model_version": metrics.get("model_version", "1"),
        "metrics": {k: v for k, v in metrics.items()
                    if isinstance(v, (int, float, str, bool))},
    }
    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2, default=str)


def train_models(
    conn,
    stat_types: List[str] = None,
    dry_run: bool = False,
    run_cv: bool = False,
    run_tune: bool = False,
    auto_mode: bool = False,
    tune_trials: int = 50,
) -> Dict[str, Any]:
    """
    Train XGBoost models for each stat type.

    Args:
        conn: Database connection.
        stat_types: Stat types to train (None = all trainable).
        dry_run: If True, just report data stats without training.
        run_cv: If True, run time-series cross-validation.
        run_tune: If True, run Optuna hyperparameter tuning before training.
        auto_mode: If True, only retrain if enough new data since last train.
        tune_trials: Number of Optuna trials.

    Returns:
        Dict of stat_type -> training metrics.
    """
    if stat_types is None:
        stat_types = TRAINABLE_STATS

    config = XGBoostConfig()
    outcome_logger = OutcomeLogger(conn)
    results = {}

    # Report available data
    stats = get_training_stats(conn)
    logger.info("=" * 60)
    logger.info("TRAINING DATA SUMMARY")
    logger.info("=" * 60)
    for st in stat_types:
        info = stats.get(st, {'labeled': 0, 'total': 0})
        status = "READY" if info.get('labeled', 0) >= config.min_training_samples else "INSUFFICIENT"
        logger.info(f"  {st:20s}: {info.get('labeled', 0):5d} labeled / {info.get('total', 0):5d} total  [{status}]")
    logger.info("=" * 60)

    if dry_run:
        return stats

    # Initialize model
    model_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        config.model_dir,
    )

    for stat_type in stat_types:
        logger.info(f"\n{'='*40}")
        logger.info(f"TRAINING: {stat_type}")
        logger.info(f"{'='*40}")

        # Auto-retrain check
        if auto_mode and not check_auto_retrain(conn, stat_type):
            logger.info(f"Skipping {stat_type}: not enough new data for auto-retrain")
            results[stat_type] = {'status': 'skipped', 'reason': 'no_new_data'}
            continue

        # Get training data (includes 'source' field: 'real' or 'synthetic')
        training_data = outcome_logger.get_training_data(
            stat_type=stat_type,
            limit=10000,
        )

        if len(training_data) < 30:
            logger.warning(f"Skipping {stat_type}: only {len(training_data)} samples (need 30+)")
            results[stat_type] = {'status': 'skipped', 'reason': 'insufficient_data', 'n_samples': len(training_data)}
            continue

        # Log training data composition
        n_real = sum(1 for r in training_data if r.get('source', 'real') == 'real')
        n_synthetic = len(training_data) - n_real
        logger.info(
            f"Training on {n_real} real outcomes + {n_synthetic} synthetic rows "
            f"(real weight=3x, synthetic weight=1x)"
        )

        if len(training_data) < config.min_training_samples:
            logger.warning(
                f"{stat_type}: {len(training_data)} samples (below recommended {config.recommended_samples}). "
                f"Training anyway with caution."
            )

        # Run time-series CV if requested
        cv_metrics = {}
        if run_cv:
            logger.info(f"Running time-series cross-validation for {stat_type}...")
            cv_metrics = time_series_cv(training_data, stat_type, n_splits=3, config=config)
            if "error" not in cv_metrics:
                logger.info(
                    f"  CV results: acc={cv_metrics.get('cv_val_accuracy_mean', 0):.4f} "
                    f"(+/- {cv_metrics.get('cv_val_accuracy_std', 0):.4f}), "
                    f"logloss={cv_metrics.get('cv_val_logloss_mean', 0):.4f}"
                )

        # Run Optuna tuning if requested
        tuned_params = {}
        if run_tune and len(training_data) >= 200:
            logger.info(f"Tuning hyperparameters for {stat_type} ({tune_trials} trials)...")
            tuned_params = tune_hyperparameters(training_data, stat_type, n_trials=tune_trials)

        # Build model with best params (tuned or default)
        model_params = {
            "n_estimators": tuned_params.get("n_estimators", config.n_estimators),
            "max_depth": tuned_params.get("max_depth", config.max_depth),
            "learning_rate": tuned_params.get("learning_rate", config.learning_rate),
            "min_child_weight": tuned_params.get("min_child_weight", config.min_child_weight),
            "subsample": tuned_params.get("subsample", config.subsample),
            "colsample_bytree": tuned_params.get("colsample_bytree", config.colsample_bytree),
            "reg_alpha": tuned_params.get("reg_alpha", config.reg_alpha),
            "reg_lambda": tuned_params.get("reg_lambda", config.reg_lambda),
        }

        model = XGBoostPropModel(
            **model_params,
            model_dir=model_dir,
            early_stopping_rounds=config.early_stopping_rounds,
            use_calibration=config.use_calibration,
            sample_weight_halflife_days=config.sample_weight_halflife_days,
        )

        # Train
        metrics = model.train(
            training_data=training_data,
            stat_type=stat_type,
            validation_split=config.validation_split,
        )

        if 'error' in metrics:
            logger.error(f"{stat_type} training failed: {metrics['error']}")
            results[stat_type] = metrics
            continue

        # Merge CV metrics
        metrics.update(cv_metrics)
        if tuned_params:
            metrics["tuned_params"] = tuned_params

        # Attach composition info to metrics before saving metadata
        metrics["n_real"] = n_real
        metrics["n_synthetic"] = n_synthetic
        metrics["model_version"] = str(int(datetime.utcnow().timestamp()))

        # Save model
        if model.save(stat_type):
            logger.info(f"Saved {stat_type} model to {model_dir}/{stat_type}.json")
            save_training_metadata(stat_type, metrics)
        else:
            logger.error(f"Failed to save {stat_type} model")

        # Log results
        logger.info(f"  Validation accuracy: {metrics.get('val_accuracy', 0):.4f}")
        logger.info(f"  Validation logloss:  {metrics.get('val_logloss', 0):.4f}")
        logger.info(f"  Validation Brier:    {metrics.get('val_brier', 0):.4f}")
        logger.info(f"  Calibrated:          {metrics.get('calibrated', False)}")
        logger.info(f"  Best iteration:      {metrics.get('best_iteration', 'N/A')}")
        logger.info(f"  Model type:          {metrics.get('model_type', 'unknown')}")
        logger.info(f"  Train/Val split:     {metrics.get('n_train', 0)} / {metrics.get('n_val', 0)}")
        if metrics.get('n_pruned', 0) > 0:
            logger.info(f"  Low-importance feats: {metrics.get('n_pruned', 0)}")

        top_features = metrics.get('top_features', [])
        if top_features:
            logger.info(f"  Top 5 features:")
            for fname, importance in top_features[:5]:
                logger.info(f"    {fname:30s} {importance:.4f}")

        metrics['status'] = 'trained'
        results[stat_type] = metrics

    # Summary
    logger.info(f"\n{'='*60}")
    logger.info("TRAINING SUMMARY")
    logger.info(f"{'='*60}")
    trained = sum(1 for r in results.values() if r.get('status') == 'trained')
    skipped = sum(1 for r in results.values() if r.get('status') == 'skipped')
    failed = len(results) - trained - skipped
    logger.info(f"  Trained: {trained}  Skipped: {skipped}  Failed: {failed}")

    for stat_type, metrics in results.items():
        if metrics.get('status') == 'trained':
            logger.info(
                f"  {stat_type:20s}: acc={metrics.get('val_accuracy', 0):.4f}  "
                f"logloss={metrics.get('val_logloss', 0):.4f}  "
                f"brier={metrics.get('val_brier', 0):.4f}  "
                f"n={metrics.get('n_train', 0)+metrics.get('n_val', 0)}"
            )

    return results


def main():
    parser = argparse.ArgumentParser(description='Train XGBoost models for NBA prop prediction')
    parser.add_argument('--stat', type=str, help='Train a single stat type (e.g. Points)')
    parser.add_argument('--bootstrap', action='store_true', help='Bootstrap training data from historical lines')
    parser.add_argument('--dry-run', action='store_true', help='Show data stats without training')
    parser.add_argument('--cv', action='store_true', help='Run time-series cross-validation')
    parser.add_argument('--tune', action='store_true', help='Run Optuna hyperparameter tuning')
    parser.add_argument('--tune-trials', type=int, default=50, help='Number of Optuna trials (default: 50)')
    parser.add_argument('--auto', action='store_true', help='Auto-retrain only if enough new data')
    parser.add_argument('--force', action='store_true', help='Force retrain all stat types regardless of new data count (overrides --auto)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose logging')
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    conn = get_db_connection()
    if conn is None:
        logger.error("Cannot connect to database. Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD.")
        sys.exit(1)

    stat_types = [args.stat] if args.stat else None

    try:
        # Bootstrap if requested
        if args.bootstrap:
            logger.info("Bootstrapping training data from historical lines...")
            inserted = bootstrap_training_data(conn, stat_types)
            logger.info(f"Bootstrap complete: {inserted} records inserted")

        # Train
        # --force explicitly disables auto mode so all stat types are retrained
        auto_mode = args.auto and not args.force
        results = train_models(
            conn,
            stat_types=stat_types,
            dry_run=args.dry_run,
            run_cv=args.cv,
            run_tune=args.tune,
            auto_mode=auto_mode,
            tune_trials=args.tune_trials,
        )

        # Output JSON summary
        print("\n" + json.dumps(results, indent=2, default=str))

    finally:
        conn.close()


if __name__ == '__main__':
    main()
