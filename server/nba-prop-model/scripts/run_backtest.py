#!/usr/bin/env python3
"""
run_backtest.py - CLI wrapper for BacktestEngine.

Evaluates historical signal accuracy and tier hit rates against settled lines.
Reports: signal accuracy per stat type, tier ROI (SMASH/STRONG/LEAN/AVOID),
and optionally saves results to the signal_performance table.

Usage:
    python scripts/run_backtest.py                              # All stats, last 30 days
    python scripts/run_backtest.py --days 90                   # Last 90 days
    python scripts/run_backtest.py --stat Points               # Single stat
    python scripts/run_backtest.py --days 180 --save           # Save to DB
    python scripts/run_backtest.py --end-date 2025-03-01       # Specific end date

VPS usage:
    cd /var/www/courtsideedge
    python3 server/nba-prop-model/scripts/run_backtest.py --days 90 --save

Output:
    Per-stat table showing: signal accuracy, OVER/UNDER breakdown, grade (HIGH/MEDIUM/LOW/NOISE)
    Tier ROI table showing: hit rate, flat -110 ROI, vs break-even (52.38%) for SMASH/STRONG/LEAN
"""

import os
import sys
import argparse
import json
import logging
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.db_config import get_connection as get_db_connection
from src.evaluation.backtest_engine import BacktestEngine, run_full_backtest

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

TRAINABLE_STATS = ['Points', 'Rebounds', 'Assists', '3-Pointers Made', 'Steals', 'Blocks', 'Turnovers']


def print_tier_summary(all_results: dict) -> None:
    """Print a cross-stat tier ROI summary table."""
    # Aggregate tier stats across all stat types
    from collections import defaultdict
    agg = defaultdict(lambda: {'total': 0, 'wins': 0, 'roi': 0.0})

    for stat_type, results in all_results.items():
        for tier, roi in results.tier_roi.items():
            if roi.total_bets > 0:
                agg[tier]['total'] += roi.total_bets
                agg[tier]['wins'] += roi.wins
                agg[tier]['roi'] += roi.flat_roi

    print("\n" + "=" * 60)
    print("COMBINED TIER SUMMARY (all stat types)")
    print("=" * 60)
    print(f"{'Tier':<10} {'Bets':>6} {'Wins':>6} {'Hit%':>8} {'ROI$':>8} {'ROI%':>8} {'vs BE':>8}")
    print("-" * 60)
    for tier in ("SMASH", "STRONG", "LEAN", "SKIP"):
        d = agg.get(tier)
        if not d or d['total'] == 0:
            continue
        hit_rate = d['wins'] / d['total']
        roi_pct = d['roi'] / d['total'] * 100
        be_gap = (hit_rate - 0.5238) * 100
        profitable = " *" if hit_rate >= 0.5238 and d['total'] >= 20 else ""
        print(
            f"{tier:<10} {d['total']:>6} {d['wins']:>6} "
            f"{hit_rate*100:>7.1f}% {d['roi']:>8.1f} "
            f"{roi_pct:>7.1f}% {be_gap:>+7.1f}pp{profitable}"
        )
    print("=" * 60)
    print("  * = profitable at -110 juice (hit rate >= 52.38%)")


def main():
    parser = argparse.ArgumentParser(
        description='Run historical signal backtest to measure accuracy and tier ROI'
    )
    parser.add_argument(
        '--days', type=int, default=30,
        help='Number of days to look back (default: 30)'
    )
    parser.add_argument(
        '--stat', type=str,
        help='Evaluate a single stat type (e.g. Points). Default: all 7 stat types.'
    )
    parser.add_argument(
        '--end-date', type=str, metavar='YYYY-MM-DD',
        help='End date for backtest window (default: yesterday)'
    )
    parser.add_argument(
        '--save', action='store_true',
        help='Save results to signal_performance and backtest_runs tables in DB'
    )
    parser.add_argument(
        '--json', action='store_true',
        help='Output full results as JSON (in addition to the summary tables)'
    )
    parser.add_argument(
        '--verbose', '-v', action='store_true',
        help='Enable verbose logging'
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    stat_types = [args.stat] if args.stat else TRAINABLE_STATS

    logger.info("=" * 60)
    logger.info("SIGNAL BACKTEST")
    logger.info(f"  Stat types: {stat_types}")
    logger.info(f"  Lookback:   {args.days} days")
    logger.info(f"  End date:   {args.end_date or 'yesterday'}")
    logger.info(f"  Save to DB: {args.save}")
    logger.info("=" * 60)

    conn = get_db_connection()
    if conn is None:
        logger.error("Cannot connect to database")
        sys.exit(1)

    engine = BacktestEngine(db_connection=conn)
    all_results = {}

    try:
        for stat_type in stat_types:
            logger.info(f"Running backtest for {stat_type}...")
            results = engine.run(
                days=args.days,
                stat_type=stat_type,
                end_date=args.end_date,
            )
            all_results[stat_type] = results

            # Print per-stat summary table
            print(results.get_summary_table())

            if args.save:
                saved = engine.save_to_db(results)
                if saved:
                    logger.info(f"  Saved {stat_type} results to DB")
                else:
                    logger.warning(f"  Failed to save {stat_type} results to DB")

        # Combined tier summary across all stats
        print_tier_summary(all_results)

        if args.json:
            output = {st: r.to_dict() for st, r in all_results.items()}
            print("\n" + json.dumps(output, indent=2, default=str))

    finally:
        conn.close()


if __name__ == '__main__':
    main()
