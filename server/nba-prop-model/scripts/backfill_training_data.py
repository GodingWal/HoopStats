#!/usr/bin/env python3
"""
backfill_training_data.py - Seed xgboost_training_log with ALL historical settled outcomes.

One-time script to jumpstart XGBoost training accuracy by backfilling real labeled data
from prizepicks_daily_lines (where actual_value is already populated by populate_actuals).

What it does:
  1. Queries ALL rows from prizepicks_daily_lines where actual_value IS NOT NULL
     (i.e., the game has been played and results are known).
  2. Joins with the players table to get stat averages for feature building.
  3. For each line, builds the full XGBoost feature context (season avg, last 5, last 10,
     hit rate, opponent info, etc.) using XGBoostFeatureBuilder.
  4. Determines outcome: OVER if actual > line, UNDER if actual < line.
  5. Inserts/upserts into xgboost_training_log with source='real'.
     - Rows already marked source='real' are skipped (idempotent).
     - Rows previously marked source='synthetic' are upgraded to source='real'.
  6. Logs progress: "Processed X / Y  |  Inserted: N  Updated: U  Skipped: S"

After running this, retrain the models:
    python3 server/nba-prop-model/scripts/train_xgboost.py --force

VPS usage:
    cd /var/www/courtsideedge
    python3 server/nba-prop-model/scripts/backfill_training_data.py
    python3 server/nba-prop-model/scripts/backfill_training_data.py --dry-run
    python3 server/nba-prop-model/scripts/backfill_training_data.py --stat Points
    python3 server/nba-prop-model/scripts/backfill_training_data.py --since 2024-10-01
"""

import os
import sys
import argparse
import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.db_config import get_connection as get_db_connection
from src.features.xgboost_features import XGBoostFeatureBuilder

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Stat types we train models for
TRAINABLE_STATS = ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Steals', 'Blocks', 'Turnovers']

# Commit to DB every N rows
BATCH_SIZE = 500


def fetch_historical_lines(
    cursor,
    stat_types: List[str],
    since_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Load all settled lines from prizepicks_daily_lines joined with players stats.

    Returns rows with both the line info and player averages for feature building.
    """
    date_filter = ""
    params: List[Any] = [stat_types]
    if since_date:
        date_filter = "AND pdl.game_date >= %s"
        params.append(since_date)

    cursor.execute(f"""
        SELECT
            pdl.prizepicks_player_id   AS player_id,
            pdl.player_name,
            pdl.team,
            pdl.opponent,
            pdl.stat_type,
            COALESCE(pdl.closing_line, pdl.opening_line) AS line_value,
            pdl.actual_value,
            pdl.game_date,
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
          {date_filter}
        ORDER BY pdl.game_date ASC, pdl.player_name, pdl.stat_type
    """, params)

    columns = [d[0] for d in cursor.description]
    rows = cursor.fetchall()
    return [dict(zip(columns, row)) for row in rows]


def _safe_json(val) -> Dict:
    """Parse a value that may be a dict, JSON string, or None."""
    if val is None:
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return {}
    return {}


def build_context(row: Dict[str, Any]) -> Dict[str, Any]:
    """Build feature context dict from a database row."""
    context = {
        'line':        float(row['line_value']),
        'stat_type':   row['stat_type'],
        'player_name': row.get('player_name', ''),
        'team':        row.get('team', ''),
        'opponent':    row.get('opponent', ''),
        'game_date':   str(row.get('game_date', '')),
    }

    context['season_averages']  = _safe_json(row.get('season_averages'))
    context['last_5_averages']  = _safe_json(row.get('last_5_averages'))
    context['last_10_averages'] = _safe_json(row.get('last_10_averages'))
    context['home_averages']    = _safe_json(row.get('home_averages'))
    context['away_averages']    = _safe_json(row.get('away_averages'))

    if row.get('usage_rate') is not None:
        context['usage_rate'] = float(row['usage_rate'])
    if row.get('ts_pct') is not None:
        context['ts_pct'] = float(row['ts_pct'])
    if row.get('actual_value') is not None:
        context['actual_value'] = float(row['actual_value'])

    # Extract game logs from recent_games for volatility features
    recent = _safe_json(row.get('recent_games'))
    if isinstance(recent, list):
        context['game_logs'] = recent
    elif isinstance(recent, dict) and 'games' in recent:
        context['game_logs'] = recent['games']

    # Home/away detection from opponent field (e.g. "@ BOS" vs "BOS")
    opp = (row.get('opponent') or '').strip()
    if opp.startswith('@'):
        context['is_home'] = False
    else:
        context['is_home'] = True

    return context


def get_already_real_ids(cursor) -> set:
    """
    Fetch the set of (player_id, game_date, stat_type) already settled as source='real'.
    Used to skip rows we've already backfilled.
    """
    cursor.execute("""
        SELECT player_id, game_date::text, stat_type
        FROM xgboost_training_log
        WHERE source = 'real'
          AND actual_value IS NOT NULL
    """)
    return {(r[0], r[1], r[2]) for r in cursor.fetchall()}


def backfill(
    stat_types: List[str] = None,
    since_date: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, int]:
    """
    Main backfill routine.

    Returns counts: total, inserted, updated (synthetic→real), skipped, errors.
    """
    if stat_types is None:
        stat_types = TRAINABLE_STATS

    counts = {'total': 0, 'inserted': 0, 'updated': 0, 'skipped': 0, 'errors': 0}

    conn = get_db_connection()
    if conn is None:
        logger.error("Cannot connect to database")
        return counts

    feature_builder = XGBoostFeatureBuilder(use_advanced=True)

    try:
        cursor = conn.cursor()

        logger.info(f"Loading historical lines (stat_types={stat_types}, since={since_date or 'all time'})...")
        rows = fetch_historical_lines(cursor, stat_types, since_date)
        counts['total'] = len(rows)
        logger.info(f"Found {len(rows)} settled lines to process")

        if not rows:
            logger.info("Nothing to backfill.")
            cursor.close()
            return counts

        if dry_run:
            # Estimate counts without writing
            already_real = get_already_real_ids(cursor)
            for row in rows:
                key = (str(row['player_id']), str(row['game_date']), row['stat_type'])
                if key in already_real:
                    counts['skipped'] += 1
                else:
                    counts['inserted'] += 1
            logger.info(
                f"[DRY-RUN] Would insert/update {counts['inserted']} rows, "
                f"skip {counts['skipped']} already-real rows"
            )
            cursor.close()
            return counts

        # Load existing real rows to skip
        already_real = get_already_real_ids(cursor)
        logger.info(f"Already settled as real: {len(already_real)} rows (will skip these)")

        batch_insert: List[tuple] = []
        batch_update: List[tuple] = []
        processed = 0

        for row in rows:
            processed += 1
            player_id = str(row['player_id'])
            game_date = str(row['game_date'])
            stat_type = row['stat_type']
            actual = float(row['actual_value'])
            line = float(row['line_value'])

            key = (player_id, game_date, stat_type)

            # Skip rows already marked as real — idempotent
            if key in already_real:
                counts['skipped'] += 1
                _maybe_log_progress(processed, counts['total'], counts)
                continue

            # Determine outcome
            hit = actual > line
            direction = 'OVER' if actual > line else ('UNDER' if actual < line else 'UNDER')

            # Build feature vector
            try:
                context = build_context(row)
                fv = feature_builder.build(context)
                features_json = json.dumps(fv.features)
            except Exception as e:
                logger.debug(f"Feature build failed for {row.get('player_name')} {stat_type} {game_date}: {e}")
                features_json = json.dumps({})

            # Check if there's a synthetic row to upgrade
            cursor.execute("""
                SELECT id, source FROM xgboost_training_log
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
            """, (player_id, game_date, stat_type))
            existing = cursor.fetchone()

            now = datetime.utcnow()

            if existing:
                # Upgrade synthetic→real (or fill in missing actual on any existing row)
                batch_update.append((
                    actual, hit, features_json, 'real', now,
                    player_id, game_date, stat_type,
                ))
                counts['updated'] += 1
            else:
                # Insert brand-new real row
                batch_insert.append((
                    player_id,
                    game_date,
                    stat_type,
                    line,
                    features_json,
                    0.0,    # signal_score — no live prediction was captured
                    0.0,    # edge_total
                    direction,
                    'LEAN', # confidence_tier placeholder
                    actual,
                    hit,
                    'real',
                    now,    # captured_at
                    now,    # settled_at
                ))
                counts['inserted'] += 1

            # Flush batches
            if len(batch_insert) + len(batch_update) >= BATCH_SIZE:
                _flush_batches(cursor, batch_insert, batch_update)
                conn.commit()
                batch_insert.clear()
                batch_update.clear()

            _maybe_log_progress(processed, counts['total'], counts)

        # Final flush
        if batch_insert or batch_update:
            _flush_batches(cursor, batch_insert, batch_update)
            conn.commit()

        cursor.close()
        logger.info(
            f"\nBackfill complete: "
            f"{counts['inserted']} inserted, "
            f"{counts['updated']} upgraded synthetic→real, "
            f"{counts['skipped']} already-real skipped, "
            f"{counts['errors']} errors"
        )

    except Exception as e:
        logger.error(f"Backfill failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        try:
            conn.close()
        except Exception:
            pass

    return counts


def _flush_batches(cursor, inserts: List[tuple], updates: List[tuple]) -> None:
    """Write pending insert and update batches to DB."""
    if inserts:
        cursor.executemany("""
            INSERT INTO xgboost_training_log (
                player_id, game_date, stat_type, line_value,
                features, signal_score, edge_total,
                predicted_direction, confidence_tier,
                actual_value, hit, source,
                captured_at, settled_at
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (player_id, game_date, stat_type) DO NOTHING
        """, inserts)

    if updates:
        cursor.executemany("""
            UPDATE xgboost_training_log
            SET actual_value = %s,
                hit          = %s,
                features     = CASE WHEN features IS NULL OR features = '{}'::jsonb
                                    THEN %s::jsonb
                                    ELSE features END,
                source       = %s,
                settled_at   = %s
            WHERE player_id = %s AND game_date = %s AND stat_type = %s
        """, updates)


_last_logged_pct = -1

def _maybe_log_progress(processed: int, total: int, counts: Dict[str, int]) -> None:
    """Log progress at every 10% milestone."""
    global _last_logged_pct
    if total == 0:
        return
    pct = int(processed / total * 10) * 10
    if pct > _last_logged_pct:
        _last_logged_pct = pct
        logger.info(
            f"Progress: {processed}/{total} ({pct}%)  |  "
            f"Inserted: {counts['inserted']}  "
            f"Updated: {counts['updated']}  "
            f"Skipped: {counts['skipped']}"
        )


def print_training_log_summary(conn) -> None:
    """Print a summary of xgboost_training_log after backfill."""
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT
                stat_type,
                source,
                COUNT(*) as rows,
                COUNT(actual_value) as labeled,
                MIN(game_date) as earliest,
                MAX(game_date) as latest
            FROM xgboost_training_log
            GROUP BY stat_type, source
            ORDER BY stat_type, source
        """)
        rows = cursor.fetchall()
        cursor.close()

        if not rows:
            print("xgboost_training_log is empty.")
            return

        print("\n" + "=" * 70)
        print("xgboost_training_log SUMMARY")
        print("=" * 70)
        print(f"{'Stat':<22} {'Source':<12} {'Rows':>6} {'Labeled':>8} {'Earliest':>12} {'Latest':>12}")
        print("-" * 70)
        for r in rows:
            print(f"{r[0]:<22} {r[1]:<12} {r[2]:>6} {r[3]:>8} {str(r[4]):>12} {str(r[5]):>12}")
        print("=" * 70)

    except Exception as e:
        logger.warning(f"Could not print summary: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='Backfill xgboost_training_log with historical settled outcomes (source=real)'
    )
    parser.add_argument(
        '--stat', type=str,
        help='Backfill only this stat type (e.g. Points). Default: all trainable stats.'
    )
    parser.add_argument(
        '--since', type=str, metavar='YYYY-MM-DD',
        help='Only backfill lines from this date onwards. Default: all time.'
    )
    parser.add_argument(
        '--dry-run', action='store_true',
        help='Show what would be inserted/skipped without writing to the database.'
    )
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='Enable verbose (DEBUG) logging.'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    stat_types = [args.stat] if args.stat else None

    logger.info("=" * 60)
    logger.info("BACKFILL TRAINING DATA")
    logger.info(f"  Stats:    {stat_types or TRAINABLE_STATS}")
    logger.info(f"  Since:    {args.since or 'all time'}")
    logger.info(f"  Dry-run:  {args.dry_run}")
    logger.info("=" * 60)

    counts = backfill(
        stat_types=stat_types,
        since_date=args.since,
        dry_run=args.dry_run,
    )

    print("\n" + json.dumps(counts, indent=2))

    if not args.dry_run:
        conn = get_db_connection()
        if conn:
            print_training_log_summary(conn)
            conn.close()

        total_new = counts['inserted'] + counts['updated']
        print(f"\nNext step: retrain the models with this data:")
        print(f"  cd /var/www/courtsideedge")
        print(f"  python3 server/nba-prop-model/scripts/train_xgboost.py --force")


if __name__ == '__main__':
    main()
