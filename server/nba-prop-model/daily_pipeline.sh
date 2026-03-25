#!/bin/bash
# =============================================================================
# CourtSideEdge Daily Pipeline
# Runs: capture -> projections -> parlays (sequential)
# =============================================================================

set -euo pipefail

# Configuration
APP_DIR="/var/www/courtsideedge/server/nba-prop-model"
VENV_DIR="$APP_DIR/venv"
LOG_DIR="/var/log/courtsideedge"
LOG_FILE="$LOG_DIR/pipeline.log"
export DATABASE_URL="postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge"

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Logging helper
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] $1" | tee -a "$LOG_FILE"
}

# Change to app directory
cd "$APP_DIR"

# Activate virtual environment
source "$VENV_DIR/bin/activate"

log "========== PIPELINE START =========="

# Step 1: Capture PrizePicks lines
log "Step 1/3: Starting capture..."
if python scripts/cron_jobs.py capture >> "$LOG_FILE" 2>&1; then
    log "Step 1/3: Capture completed successfully."
else
    log "ERROR: Step 1/3 capture failed (exit code $?). Continuing..."
fi

# Step 1.5: Fetch injury reports and calculate usage redistribution
log "Step 1.5: Fetching injuries..."
if python scripts/fetch_injuries.py >> "$LOG_FILE" 2>&1; then
    log "Step 1.5: Injuries fetched successfully."
else
    log "ERROR: Step 1.5 injuries failed (exit code $?). Continuing..."
fi

# Step 2: Run projection engine
log "Step 2/3: Starting projections..."
if python scripts/cron_jobs.py projections >> "$LOG_FILE" 2>&1; then
    log "Step 2/3: Projections completed successfully."
else
    log "ERROR: Step 2/3 projections failed (exit code $?). Continuing..."
fi

# Step 3: Generate parlay recommendations (sizes 2-6 sequentially)
for PSIZE in 2 3 4 5 6; do
  log "Step 3: Starting parlays (size=$PSIZE)..."
  if python scripts/cron_jobs.py parlays --size $PSIZE >> "$LOG_FILE" 2>&1; then
    log "Step 3: Parlays size=$PSIZE completed successfully."
  else
    log "ERROR: Step 3 parlays size=$PSIZE failed (exit code $?). Continuing..."
  fi
done

log "========== PIPELINE COMPLETE =========="
