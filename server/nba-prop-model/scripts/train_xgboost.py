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
from typing import Dict, Any, List, Optional

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models.xgboost_model import XGBoostPropModel
from src.evaluation.outcome_logger import OutcomeLogger
from src.features.xgboost_features import XGBoostFeatureBuilder, XGBOOST_FEATURE_NAMES
from config.settings import XGBoostConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Stat types to train models for
TRAINABLE_STATS = ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Steals', 'Blocks', 'Turnovers']


def get_db_connection():
    """Get database connection from environment."""
    try:
        import psycopg2
        db_url = os.environ.get('DATABASE_URL')
        if db_url:
            return psycopg2.connect(db_url)
        return psycopg2.connect(
            host=os.environ.get('DB_HOST', 'localhost'),
            port=os.environ.get('DB_PORT', 5432),
            database=os.environ.get('DB_NAME', 'courtsideedge'),
            user=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', ''),
        )
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return None


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

    feature_builder = XGBoostFeatureBuilder()
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

                # Insert into training log
                cursor.execute("""
                    INSERT INTO xgboost_training_log (
                        player_id, game_date, stat_type, line_value,
                        features, signal_score, edge_total,
                        predicted_direction, confidence_tier,
                        actual_value, hit, captured_at, settled_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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


def train_models(
    conn,
    stat_types: List[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """
    Train XGBoost models for each stat type.

    Args:
        conn: Database connection.
        stat_types: Stat types to train (None = all trainable).
        dry_run: If True, just report data stats without training.

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
    model = XGBoostPropModel(
        n_estimators=config.n_estimators,
        max_depth=config.max_depth,
        learning_rate=config.learning_rate,
        min_child_weight=config.min_child_weight,
        subsample=config.subsample,
        colsample_bytree=config.colsample_bytree,
        reg_alpha=config.reg_alpha,
        reg_lambda=config.reg_lambda,
        model_dir=model_dir,
    )

    for stat_type in stat_types:
        logger.info(f"\n{'='*40}")
        logger.info(f"TRAINING: {stat_type}")
        logger.info(f"{'='*40}")

        # Get training data
        training_data = outcome_logger.get_training_data(
            stat_type=stat_type,
            limit=10000,
        )

        if len(training_data) < 30:
            logger.warning(f"Skipping {stat_type}: only {len(training_data)} samples (need 30+)")
            results[stat_type] = {'status': 'skipped', 'reason': 'insufficient_data', 'n_samples': len(training_data)}
            continue

        if len(training_data) < config.min_training_samples:
            logger.warning(
                f"{stat_type}: {len(training_data)} samples (below recommended {config.recommended_samples}). "
                f"Training anyway with caution."
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

        # Save model
        if model.save(stat_type):
            logger.info(f"Saved {stat_type} model to {model_dir}/{stat_type}.json")
        else:
            logger.error(f"Failed to save {stat_type} model")

        # Log results
        logger.info(f"  Validation accuracy: {metrics.get('val_accuracy', 0):.4f}")
        logger.info(f"  Validation logloss:  {metrics.get('val_logloss', 0):.4f}")
        logger.info(f"  Model type:          {metrics.get('model_type', 'unknown')}")
        logger.info(f"  Train/Val split:     {metrics.get('n_train', 0)} / {metrics.get('n_val', 0)}")

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
                f"n={metrics.get('n_train', 0)+metrics.get('n_val', 0)}"
            )

    return results


def main():
    parser = argparse.ArgumentParser(description='Train XGBoost models for NBA prop prediction')
    parser.add_argument('--stat', type=str, help='Train a single stat type (e.g. Points)')
    parser.add_argument('--bootstrap', action='store_true', help='Bootstrap training data from historical lines')
    parser.add_argument('--dry-run', action='store_true', help='Show data stats without training')
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
        results = train_models(conn, stat_types=stat_types, dry_run=args.dry_run)

        # Output JSON summary
        print("\n" + json.dumps(results, indent=2, default=str))

    finally:
        conn.close()


if __name__ == '__main__':
    main()
