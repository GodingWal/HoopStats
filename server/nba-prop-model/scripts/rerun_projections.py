#!/usr/bin/env python3
"""Re-run capture_projections for recent dates with enriched context."""
import os, sys, logging
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
os.environ['DATABASE_URL'] = 'postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge'

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

from datetime import datetime, timedelta

# Import the capture function
from scripts.cron_jobs import capture_projections, populate_actuals, run_validation

# Re-run capture for recent dates (last 7 days)
dates = []
for i in range(7):
    d = (datetime.now() - timedelta(days=i)).strftime('%Y-%m-%d')
    dates.append(d)

total_captured = 0
for d in dates:
    logger.info(f"Capturing projections for {d}...")
    try:
        n = capture_projections(d)
        total_captured += n
        logger.info(f"  {d}: captured {n} projections")
    except Exception as e:
        logger.error(f"  {d}: error - {e}")

logger.info(f"Total captured: {total_captured}")

# Populate actuals for past dates
for d in dates[1:]:  # Skip today
    logger.info(f"Populating actuals for {d}...")
    try:
        n = populate_actuals(d)
        logger.info(f"  {d}: updated {n} actuals")
    except Exception as e:
        logger.error(f"  {d}: actuals error - {e}")

# Run validation
logger.info("Running signal validation...")
try:
    run_validation()
    logger.info("Validation complete")
except Exception as e:
    logger.error(f"Validation error: {e}")

logger.info("=== ALL DONE ===")
