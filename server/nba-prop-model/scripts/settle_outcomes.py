#!/usr/bin/env python3
"""
settle_outcomes.py - Settle yesterday's PrizePicks lines against real game results.

Runs daily at 6:00 AM ET (after west coast games finish and box scores are posted).

What it does:
  1. Queries prizepicks_daily_lines for yesterday's lines that have actual_value filled in
     (actual_value is populated by populate_actuals at 2 AM ET).
  2. For each line, looks up the corresponding xgboost_training_log row.
     - If a row exists (pre-game prediction was captured), updates it with the real outcome.
     - If no row exists (no live prediction was captured), inserts a new row tagged source='real'
       so the training pipeline still gets real labeled data.
  3. Writes settled results with: player_id, stat_type, line, actual_value, hit, game_date,
     and marks source='real' to distinguish from synthetic bootstrap data.
  4. Logs a summary: how many were settled, how many were already settled, how many were skipped.
  5. After settling, checks if 100+ new real rows exist since last training and auto-triggers
     train_xgboost.py --auto if so.

Usage:
    python scripts/settle_outcomes.py               # Settle yesterday
    python scripts/settle_outcomes.py --date 2025-03-28   # Settle specific date
    python scripts/settle_outcomes.py --dry-run     # Show what would be settled
    python scripts/settle_outcomes.py --retrain-threshold 50  # Custom retrain threshold
"""

import os
import sys
import argparse
import json
import logging
import subprocess
from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List, Tuple

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.db_config import get_connection as get_db_connection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Stat types we care about for XGBoost training
TRAINABLE_STATS = {
    'Points', 'Rebounds', 'Assists', '3-Pointers Made',
    'Steals', 'Blocks', 'Turnovers',
}

# Default number of new real rows before triggering auto-retrain
DEFAULT_RETRAIN_THRESHOLD = 100


def settle_outcomes(
    target_date: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, int]:
    """
    Settle yesterday's PrizePicks lines against actual game results.

    Reads actual_value from prizepicks_daily_lines (populated at 2 AM by populate_actuals)
    and writes settled outcomes into xgboost_training_log.

    Args:
        target_date: Date to settle (YYYY-MM-DD). Defaults to yesterday.
        dry_run: If True, log what would be settled without writing anything.

    Returns:
        Dict with counts: settled, already_settled, skipped, inserted.
    """
    if target_date is None:
        yesterday = datetime.now() - timedelta(days=1)
        target_date = yesterday.strftime('%Y-%m-%d')

    logger.info(f"Settling outcomes for {target_date} (dry_run={dry_run})")

    conn = get_db_connection()
    if conn is None:
        logger.error("Cannot connect to database")
        return {'settled': 0, 'already_settled': 0, 'skipped': 0, 'inserted': 0}

    counts = {'settled': 0, 'already_settled': 0, 'skipped': 0, 'inserted': 0}

    try:
        cursor = conn.cursor()

        # Get lines from prizepicks_daily_lines that have real outcomes
        cursor.execute("""
            SELECT
                pdl.prizepicks_player_id AS player_id,
                pdl.player_name,
                pdl.stat_type,
                pdl.opening_line AS line_value,
                pdl.actual_value,
                pdl.game_date,
                pdl.opponent,
                pdl.team
            FROM prizepicks_daily_lines pdl
            WHERE pdl.game_date = %s
              AND pdl.actual_value IS NOT NULL
              AND pdl.opening_line IS NOT NULL
              AND pdl.opening_line > 0
              AND pdl.stat_type = ANY(%s)
            ORDER BY pdl.player_name, pdl.stat_type
        """, (target_date, list(TRAINABLE_STATS)))

        lines = cursor.fetchall()
        cols = [d[0] for d in cursor.description]
        logger.info(f"Found {len(lines)} settled lines in prizepicks_daily_lines for {target_date}")

        if not lines:
            logger.info(f"No settled lines found for {target_date} — nothing to do")
            cursor.close()
            conn.close()
            return counts

        settled_rows: List[Tuple] = []
        inserted_rows: List[Tuple] = []

        for row in lines:
            data = dict(zip(cols, row))
            player_id = str(data['player_id'])
            stat_type = data['stat_type']
            line_value = float(data['line_value'])
            actual_value = float(data['actual_value'])
            game_date = str(data['game_date'])

            # Determine outcome
            if actual_value > line_value:
                hit = True
                outcome = 'OVER'
            elif actual_value < line_value:
                hit = False
                outcome = 'UNDER'
            else:
                # Push: treat as miss for training purposes (conservative)
                hit = False
                outcome = 'PUSH'

            # Check if xgboost_training_log already has this row
            cursor.execute("""
                SELECT id, actual_value, source
                FROM xgboost_training_log
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
            """, (player_id, game_date, stat_type))
            existing = cursor.fetchone()

            if existing:
                existing_id, existing_actual, existing_source = existing
                if existing_actual is not None:
                    # Already settled — skip
                    counts['already_settled'] += 1
                    logger.debug(f"Already settled: {data['player_name']} {stat_type} {game_date}")
                    continue

                # Row exists but not settled — update it
                if dry_run:
                    logger.info(
                        f"[DRY-RUN] Would settle: {data['player_name']} {stat_type} "
                        f"line={line_value} actual={actual_value} outcome={outcome}"
                    )
                    counts['settled'] += 1
                    continue

                settled_rows.append((actual_value, hit, 'real', player_id, game_date, stat_type))
                counts['settled'] += 1

            else:
                # No prediction was captured for this line — insert a new real row
                # so the training pipeline still gets labeled data.
                if dry_run:
                    logger.info(
                        f"[DRY-RUN] Would insert new real row: {data['player_name']} {stat_type} "
                        f"line={line_value} actual={actual_value} outcome={outcome}"
                    )
                    counts['inserted'] += 1
                    continue

                inserted_rows.append((
                    player_id,
                    game_date,
                    stat_type,
                    line_value,
                    json.dumps({}),  # empty features — no prediction was captured
                    0.0,             # signal_score
                    0.0,             # edge_total
                    outcome if outcome != 'PUSH' else 'UNDER',
                    'LEAN',          # confidence_tier placeholder
                    actual_value,
                    hit,
                    'real',
                    datetime.utcnow(),
                    datetime.utcnow(),
                ))
                counts['inserted'] += 1

        if dry_run:
            logger.info(
                f"[DRY-RUN] Would settle {counts['settled']} rows, "
                f"insert {counts['inserted']} new rows, "
                f"skip {counts['already_settled']} already-settled"
            )
            cursor.close()
            conn.close()
            return counts

        # Execute updates for rows that had a prediction but no outcome
        if settled_rows:
            cursor.executemany("""
                UPDATE xgboost_training_log
                SET actual_value = %s,
                    hit = %s,
                    source = %s,
                    settled_at = NOW()
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
            """, settled_rows)

        # Execute inserts for lines with no prior prediction
        if inserted_rows:
            cursor.executemany("""
                INSERT INTO xgboost_training_log (
                    player_id, game_date, stat_type, line_value,
                    features, signal_score, edge_total,
                    predicted_direction, confidence_tier,
                    actual_value, hit, source,
                    captured_at, settled_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (player_id, game_date, stat_type) DO NOTHING
            """, inserted_rows)

        conn.commit()
        cursor.close()

        logger.info(
            f"Settle complete for {target_date}: "
            f"{counts['settled']} updated, "
            f"{counts['inserted']} inserted, "
            f"{counts['already_settled']} already settled, "
            f"{counts['skipped']} skipped"
        )

    except Exception as e:
        logger.error(f"Error settling outcomes: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        try:
            conn.close()
        except Exception:
            pass

    return counts


def count_new_real_rows_since_last_train() -> Dict[str, int]:
    """
    Count new real settled rows per stat type since the last training run.

    Returns dict of stat_type -> count of unseen real rows.
    """
    model_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "models", "xgboost",
    )

    conn = get_db_connection()
    if conn is None:
        return {}

    counts = {}
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT stat_type, COUNT(*) as new_rows
            FROM xgboost_training_log
            WHERE source = 'real'
              AND actual_value IS NOT NULL
            GROUP BY stat_type
        """)
        all_real = {row[0]: row[1] for row in cursor.fetchall()}

        for stat_type, total in all_real.items():
            meta_path = os.path.join(model_dir, f"{stat_type}_meta.json")
            last_real_count = 0
            if os.path.exists(meta_path):
                try:
                    with open(meta_path) as f:
                        meta = json.load(f)
                        last_real_count = meta.get('real_rows_at_last_train', 0)
                except Exception:
                    pass
            counts[stat_type] = total - last_real_count

        cursor.close()
    except Exception as e:
        logger.warning(f"Could not count new real rows: {e}")
    finally:
        try:
            conn.close()
        except Exception:
            pass

    return counts


def maybe_trigger_retrain(threshold: int = DEFAULT_RETRAIN_THRESHOLD) -> bool:
    """
    Trigger model retraining if enough new real rows have accumulated since last train.

    Args:
        threshold: Minimum new real rows across all stat types before retraining.

    Returns:
        True if retrain was triggered, False otherwise.
    """
    new_counts = count_new_real_rows_since_last_train()
    total_new = sum(new_counts.values())

    logger.info(
        f"New real rows since last train: {total_new} total "
        f"({', '.join(f'{k}={v}' for k, v in new_counts.items())})"
    )

    if total_new < threshold:
        logger.info(
            f"Retrain threshold not met: {total_new} < {threshold}. "
            f"Skipping auto-retrain."
        )
        return False

    logger.info(
        f"Retrain threshold met ({total_new} >= {threshold}). "
        f"Triggering auto-retrain..."
    )

    script_dir = os.path.dirname(os.path.abspath(__file__))
    train_script = os.path.join(script_dir, "train_xgboost.py")

    # Determine Python executable (prefer venv)
    venv_python = os.path.join(
        os.path.dirname(script_dir), "venv", "bin", "python"
    )
    python_cmd = venv_python if os.path.exists(venv_python) else sys.executable

    try:
        result = subprocess.run(
            [python_cmd, train_script, "--auto"],
            capture_output=True,
            text=True,
            timeout=600,  # 10 min max
            cwd=os.path.dirname(script_dir),
        )
        if result.returncode == 0:
            logger.info("Auto-retrain completed successfully")
            logger.debug(f"Train output: {result.stdout[-2000:] if result.stdout else ''}")
        else:
            logger.error(f"Auto-retrain failed (exit {result.returncode}): {result.stderr[-1000:]}")
    except subprocess.TimeoutExpired:
        logger.error("Auto-retrain timed out after 10 minutes")
        return False
    except Exception as e:
        logger.error(f"Failed to launch auto-retrain: {e}")
        return False

    return True


def main():
    parser = argparse.ArgumentParser(
        description='Settle PrizePicks outcomes into xgboost_training_log'
    )
    parser.add_argument(
        '--date', type=str,
        help='Target date to settle (YYYY-MM-DD). Defaults to yesterday.'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Show what would be settled without writing to the database.'
    )
    parser.add_argument(
        '--no-retrain', action='store_true',
        help='Skip the auto-retrain check after settling.'
    )
    parser.add_argument(
        '--retrain-threshold', type=int, default=DEFAULT_RETRAIN_THRESHOLD,
        help=f'New real rows needed to trigger auto-retrain (default: {DEFAULT_RETRAIN_THRESHOLD})'
    )
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='Enable verbose logging.'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Step 1: Settle outcomes
    counts = settle_outcomes(
        target_date=args.date,
        dry_run=args.dry_run,
    )

    print(json.dumps({
        'date': args.date or (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d'),
        'dry_run': args.dry_run,
        **counts,
    }, indent=2))

    # Step 2: Maybe trigger retrain (skip in dry-run mode)
    if not args.dry_run and not args.no_retrain:
        triggered = maybe_trigger_retrain(threshold=args.retrain_threshold)
        if triggered:
            print("Auto-retrain triggered.")
        else:
            print("Auto-retrain not triggered (threshold not met).")


if __name__ == '__main__':
    main()
