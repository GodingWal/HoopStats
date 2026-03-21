#!/usr/bin/env python3
"""
train_dl_models.py — Train PropNet deep learning models from projection_logs.

Usage:
    python train_dl_models.py --db-url $DATABASE_URL [options]

Options:
    --db-url        PostgreSQL connection URL (or set DATABASE_URL env var)
    --stat-types    Comma-separated stat types to train (default: all)
    --epochs        Max training epochs per model (default: 50)
    --batch-size    Mini-batch size (default: 32)
    --lr            Learning rate (default: 0.0005)
    --min-examples  Minimum rows needed to train a model (default: 50)
    --output-dir    Directory to save .npz weight files (default: model_weights/)
    --dry-run       Parse args and count examples, but don't train

Example:
    python train_dl_models.py --db-url postgresql://user:pass@host/db \\
        --stat-types "Points,Rebounds,Assists" --epochs 100
"""

from __future__ import annotations
import argparse
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("train_dl")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--db-url", default=os.environ.get("DATABASE_URL"), metavar="URL")
    p.add_argument("--stat-types", default=None, metavar="TYPES")
    p.add_argument("--epochs",       type=int,   default=50)
    p.add_argument("--batch-size",   type=int,   default=32)
    p.add_argument("--lr",           type=float, default=5e-4)
    p.add_argument("--min-examples", type=int,   default=50)
    p.add_argument("--output-dir",   default="model_weights")
    p.add_argument("--dry-run",      action="store_true")
    return p.parse_args()


def fetch_projection_logs(db_url: str) -> list[dict]:
    """
    Pull training data from the projection_logs table.

    Expects columns:
        stat_type, projected_value, actual_value,
        context_json, game_log_json
    """
    import psycopg2
    import psycopg2.extras

    logger.info("Connecting to database…")
    conn = psycopg2.connect(db_url)
    cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    cur.execute("""
        SELECT
            stat_type,
            projected_value,
            actual_value,
            context_json,
            game_log_json
        FROM projection_logs
        WHERE actual_value IS NOT NULL
          AND projected_value IS NOT NULL
        ORDER BY game_date DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    logger.info("Fetched %d rows from projection_logs.", len(rows))
    return rows


def main():
    args = parse_args()

    if not args.db_url:
        logger.error("--db-url or DATABASE_URL environment variable is required.")
        sys.exit(1)

    # Import after arg parsing so --help works without project installed
    from src.models.deep_learning import DLTrainingPipeline, ModelStore
    from src.models.deep_learning.training import TrainingConfig, SUPPORTED_STAT_TYPES

    stat_types = (
        [s.strip() for s in args.stat_types.split(",")]
        if args.stat_types
        else SUPPORTED_STAT_TYPES
    )

    config = TrainingConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        min_examples=args.min_examples,
    )

    # Fetch data
    rows = fetch_projection_logs(args.db_url)
    if not rows:
        logger.warning("No training data found in projection_logs — exiting.")
        sys.exit(0)

    # Build pipeline
    pipeline = DLTrainingPipeline(stat_types=stat_types, config=config)
    pipeline.load_examples_from_db(rows)

    # Show counts
    for st in stat_types:
        n = len(pipeline._examples.get(st, []))
        logger.info("  %-25s  %d examples", st, n)

    if args.dry_run:
        logger.info("Dry run — skipping training.")
        return

    # Train
    results = pipeline.train_all()

    # Save
    store = ModelStore(args.output_dir)
    pipeline.save_all_models(store)

    # Summary
    logger.info("\n=== Training Summary ===")
    for stat_type, res in results.items():
        logger.info(
            "  %-25s  val_mae=%.3f  val_loss=%.4f  epochs=%d  (train=%d, val=%d)",
            stat_type, res.best_val_mae, res.best_val_loss,
            res.epochs_trained, res.n_train, res.n_val,
        )
    logger.info("Models saved to: %s", args.output_dir)


if __name__ == "__main__":
    main()
