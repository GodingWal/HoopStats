#!/usr/bin/env python3
"""
Automated Pipeline Cron Jobs for NBA Prop Backtest Infrastructure

This script handles the daily capture → validate → update cycle:

1. capture_projections (10:00 AM): Capture pre-game projections before lines lock
2. populate_actuals (2:00 AM): Fill in actual values after games complete
3. run_validation (3:00 AM): Daily signal accuracy update
4. update_weights (3:30 AM Sunday): Weekly weight adjustment

Usage:
    python cron_jobs.py capture     # Capture today's projections
    python cron_jobs.py actuals     # Populate yesterday's actuals
    python cron_jobs.py validate    # Run daily validation
    python cron_jobs.py weights     # Update signal weights (weekly)
    python cron_jobs.py all         # Run full pipeline (for testing)

Crontab setup:
    0 10 * * * cd /path/to/project && python scripts/cron_jobs.py capture
    0 2 * * * cd /path/to/project && python scripts/cron_jobs.py actuals
    0 3 * * * cd /path/to/project && python scripts/cron_jobs.py validate
    30 3 * * 0 cd /path/to/project && python scripts/cron_jobs.py weights
"""

import os
import sys
import argparse
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.signals import registry, AVAILABLE_SIGNALS, SUPPORTED_STAT_TYPES
from src.evaluation.backtest_engine import BacktestEngine, run_full_backtest
from src.evaluation.weight_optimizer import WeightOptimizer, optimize_all_weights
from src.data.context_enrichment import enrich_context
from src.models.signal_projection_engine import (
    SignalProjectionEngine,
    BlendedProjection,
    build_context_from_player_data,
)
from src.models.xgboost_model import XGBoostPropModel
from src.evaluation.outcome_logger import OutcomeLogger
from config.settings import XGBoostConfig

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('/tmp/courtsideedge_cron.log'),
    ]
)
logger = logging.getLogger(__name__)


def get_db_connection():
    """
    Get database connection.

    In production, this should read from environment variables or config.
    """
    try:
        import psycopg2

        # Read from environment
        db_url = os.environ.get('DATABASE_URL')
        if db_url:
            return psycopg2.connect(db_url)

        # Fallback to individual params
        return psycopg2.connect(
            host=os.environ.get('DB_HOST', 'localhost'),
            port=os.environ.get('DB_PORT', 5432),
            database=os.environ.get('DB_NAME', 'courtsideedge'),
            user=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', ''),
        )
    except ImportError:
        logger.error("psycopg2 not installed. Install with: pip install psycopg2-binary")
        return None
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        return None


def capture_projections(target_date: Optional[str] = None) -> int:
    """
    Capture pre-game projections for today's games.

    Run at 10:00 AM before PrizePicks lines lock.

    Steps:
    1. Get today's lines from prizepicks_daily_lines
    2. For each player-stat, build context from players table
    3. Generate projection using SignalProjectionEngine
    4. Save to projection_logs

    Args:
        target_date: Date to capture (YYYY-MM-DD), defaults to today

    Returns:
        Number of projections captured
    """
    logger.info("Starting projection capture...")

    if target_date is None:
        target_date = datetime.now().strftime('%Y-%m-%d')

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return 0

    engine = SignalProjectionEngine(conn)
    captured = 0

    try:
        cursor = conn.cursor()

        # Get today's lines from PrizePicks
        cursor.execute("""
            SELECT DISTINCT
                pdl.prizepicks_player_id as player_id,
                pdl.player_name,
                pdl.team,
                pdl.stat_type,
                pdl.opening_line as line,
                pdl.opponent,
                pdl.game_date,
                p.season_averages,
                p.last_5_averages,
                p.last_10_averages,
                p.home_averages,
                p.away_averages,
                p.position,
                p.recent_games,
                p.game_logs,
                p.vs_team
            FROM prizepicks_daily_lines pdl
            LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
            WHERE pdl.game_date = %s
              AND pdl.stat_type IN %s
        """, (target_date, tuple(SUPPORTED_STAT_TYPES)))

        rows = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description]

        logger.info(f"Found {len(rows)} player-stat combinations for {target_date}")

        failed = 0
        save_failed = 0
        for row in rows:
            data = dict(zip(columns, row))

            try:
                # Build context
                context = build_context_from_player_data(data)
                context['opponent'] = data.get('opponent', '')
                context['game_date'] = target_date
                context['stat_type'] = data.get('stat_type', '')
                
                # Enrich context with all data signals need
                try:
                    enrich_context(conn, context, data)
                except Exception as enrich_err:
                    logger.debug(f"Context enrichment partial: {enrich_err}")

                # Generate projection
                projection = engine.project(
                    player_id=data['player_id'],
                    player_name=data['player_name'],
                    game_date=target_date,
                    stat_type=data['stat_type'],
                    context=context,
                    line=data.get('line'),
                )

                # Save to database
                if engine.save_projection(projection):
                    captured += 1
                    logger.debug(f"Captured: {data['player_name']} - {data['stat_type']}")
                else:
                    save_failed += 1
                    logger.warning(f"Failed to save projection for {data['player_name']} - {data['stat_type']}")

            except Exception as e:
                failed += 1
                logger.warning(f"Error projecting {data.get('player_name', '?')}: {e}")
                continue

        cursor.close()
        conn.close()

    except Exception as e:
        logger.error(f"Error in capture_projections: {e}")
        conn.close()
        return captured

    logger.info(
        f"Capture complete for {target_date}: "
        f"{captured} captured, {failed} projection errors, {save_failed} save errors "
        f"(out of {len(rows)} total)"
    )
    if failed > 0 or save_failed > 0:
        logger.warning(
            f"Data gaps detected: {failed + save_failed}/{len(rows)} "
            f"player-stats missing from projection_logs"
        )
    return captured


def populate_actuals(target_date: Optional[str] = None) -> int:
    """
    Populate actual values for completed games.

    Run at 2:00 AM after games complete.

    Steps:
    1. Get projection_logs where actual_value IS NULL for target date
    2. Fetch actual stats from NBA API for each player
    3. Update actual_value, hit_over, projection_hit, projection_error

    Args:
        target_date: Date to populate (YYYY-MM-DD), defaults to yesterday

    Returns:
        Number of records updated
    """
    from src.data.nba_api_client import NBADataClient

    logger.info("Starting actuals population...")

    if target_date is None:
        yesterday = datetime.now() - timedelta(days=1)
        target_date = yesterday.strftime('%Y-%m-%d')

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return 0

    # Initialize NBA API client
    nba_client = NBADataClient(request_delay=0.8)

    # Map stat types to NBA API column names
    # For combo stats, we'll calculate them from individual stats
    STAT_TYPE_MAP = {
        'Points': 'PTS',
        'Rebounds': 'REB',
        'Assists': 'AST',
        '3-Pointers Made': 'FG3M',
        'Steals': 'STL',
        'Blocks': 'BLK',
        'Turnovers': 'TOV',
        'Fantasy Score': None,  # Calculated
        'Pts+Rebs': ['PTS', 'REB'],  # Combo
        'Pts+Asts': ['PTS', 'AST'],  # Combo
        'Rebs+Asts': ['REB', 'AST'],  # Combo
        'Pts+Rebs+Asts': ['PTS', 'REB', 'AST'],  # Combo
        'Blks+Stls': ['BLK', 'STL'],  # Combo
        'Stls+Blks': ['BLK', 'STL'],  # Combo (alternate name)
        'Double Double': None,  # Special calculation
        'Triple Double': None,  # Special calculation
    }

    updated = 0
    # Cache player game logs to avoid repeated API calls
    player_game_cache: Dict[str, Any] = {}

    try:
        cursor = conn.cursor()

        # Get projections needing actuals
        cursor.execute("""
            SELECT
                pl.id,
                pl.player_name,
                pl.stat_type,
                pl.prizepicks_line as line,
                pl.projected_value,
                pl.predicted_direction
            FROM projection_logs pl
            WHERE pl.game_date = %s
              AND pl.actual_value IS NULL
        """, (target_date,))

        projections = cursor.fetchall()
        logger.info(f"Found {len(projections)} projections needing actuals for {target_date}")

        if not projections:
            cursor.close()
            conn.close()
            return 0

        # Determine the season based on target date (NBA season runs Oct - June)
        target_dt = datetime.strptime(target_date, '%Y-%m-%d')
        if target_dt.month >= 10:
            season = f"{target_dt.year}-{str(target_dt.year + 1)[2:]}"
        else:
            season = f"{target_dt.year - 1}-{str(target_dt.year)[2:]}"

        for proj_id, player_name, stat_type, line, projected, predicted_dir in projections:
            try:
                # Check cache first
                cache_key = player_name.lower()
                if cache_key not in player_game_cache:
                    # Look up player ID
                    player_id = nba_client.get_player_id(player_name)
                    if player_id is None:
                        logger.warning(f"Could not find NBA player ID for: {player_name}")
                        continue

                    # Fetch game log for the season
                    try:
                        game_log = nba_client.get_player_game_log(player_id, season=season)
                        player_game_cache[cache_key] = game_log
                    except Exception as api_err:
                        logger.warning(f"API error fetching game log for {player_name}: {api_err}")
                        continue
                else:
                    game_log = player_game_cache[cache_key]

                if game_log is None or game_log.empty:
                    logger.debug(f"No game log found for {player_name}")
                    continue

                # Find the game on the target date
                # GAME_DATE format from API is datetime, target_date is string
                target_dt_only = datetime.strptime(target_date, '%Y-%m-%d').date()
                
                # Try exact date first
                mask = game_log['GAME_DATE'].dt.date == target_dt_only
                game_row = game_log[mask]

                # If not found, try +/- 1 day (timezone/scheduling differences)
                if game_row.empty:
                    prev_day = target_dt_only - timedelta(days=1)
                    mask = game_log['GAME_DATE'].dt.date == prev_day
                    game_row = game_log[mask]
                    if not game_row.empty:
                        logger.debug(f"Found game on {prev_day} for target {target_date}")
                
                if game_row.empty:
                    next_day = target_dt_only + timedelta(days=1)
                    mask = game_log['GAME_DATE'].dt.date == next_day
                    game_row = game_log[mask]
                    if not game_row.empty:
                        logger.debug(f"Found game on {next_day} for target {target_date}")

                if game_row.empty:
                    logger.debug(f"No game found for {player_name} on {target_date} (+/- 1 day)")
                    continue

                # Get the actual stat value
                nba_stat_col = STAT_TYPE_MAP.get(stat_type)
                if nba_stat_col is None:
                    # Skip unsupported stat types like Fantasy Score, Double Double
                    logger.debug(f"Skipping unsupported stat type: {stat_type}")
                    continue
                
                # Handle combo stats (list of columns to sum)
                if isinstance(nba_stat_col, list):
                    try:
                        actual_value = sum(float(game_row.iloc[0][col]) for col in nba_stat_col)
                    except (KeyError, ValueError) as e:
                        logger.warning(f"Could not calculate combo stat {stat_type}: {e}")
                        continue
                else:
                    if nba_stat_col not in game_row.columns:
                        logger.warning(f"Column {nba_stat_col} not found for stat type: {stat_type}")
                        continue
                    actual_value = float(game_row.iloc[0][nba_stat_col])
                
                actual_minutes = None
                if 'MIN' in game_row.columns:
                    min_val = game_row.iloc[0]['MIN']
                    if isinstance(min_val, str) and ':' in min_val:
                        parts = min_val.split(':')
                        actual_minutes = float(parts[0]) + float(parts[1]) / 60
                    else:
                        actual_minutes = float(min_val) if min_val else None

                # Calculate hit_over relative to the line
                hit_over = actual_value > line if line else None

                # Calculate projection accuracy
                projection_error = actual_value - projected if projected else None

                # Did our prediction hit?
                if predicted_dir == 'OVER':
                    projection_hit = actual_value > line if line else None
                elif predicted_dir == 'UNDER':
                    projection_hit = actual_value < line if line else None
                else:
                    projection_hit = None

                # Update the record
                # Update projection_logs
                cursor.execute("""
                    UPDATE projection_logs
                    SET actual_value = %s,
                        actual_minutes = %s,
                        hit_over = %s,
                        projection_hit = %s,
                        projection_error = %s,
                        game_completed_at = NOW()
                    WHERE id = %s
                """, (actual_value, actual_minutes, hit_over, projection_hit, projection_error, proj_id))

                # ALSO update prizepicks_daily_lines so backtest_engine can find the data
                cursor.execute("""
                    UPDATE prizepicks_daily_lines
                    SET actual_value = %s,
                        hit_over = %s
                    WHERE LOWER(player_name) = LOWER(%s)
                      AND stat_type = %s
                      AND game_date = %s
                      AND actual_value IS NULL
                """, (actual_value, hit_over, player_name, stat_type, target_date))

                updated += 1
                logger.debug(f"Updated {player_name} {stat_type}: actual={actual_value}, hit={projection_hit}")
            except Exception as e:
                logger.warning(f"Error processing {player_name} - {stat_type}: {e}")
                continue

        conn.commit()
        cursor.close()
        conn.close()

    except Exception as e:
        logger.error(f"Error in populate_actuals: {e}")
        try:
            conn.rollback()
            conn.close()
        except:
            pass
        return updated

    logger.info(f"Updated {updated} projections with actuals for {target_date}")
    return updated


def run_validation(days: int = 30) -> Dict[str, Any]:
    """
    Run daily signal accuracy validation.

    Run at 3:00 AM daily.

    Steps:
    1. Run BacktestEngine for each stat type
    2. Save results to signal_performance table
    3. Log accuracy report

    Args:
        days: Number of days to validate

    Returns:
        Dict with validation results per stat type
    """
    logger.info(f"Running validation for past {days} days...")

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return {}

    try:
        results = run_full_backtest(
            db_connection=conn,
            days=days,
            stat_types=SUPPORTED_STAT_TYPES[:3],  # Points, Rebounds, Assists
        )

        # Save results to database
        engine = BacktestEngine(conn)
        for stat_type, result in results.items():
            if engine.save_to_db(result):
                logger.info(f"Saved validation results for {stat_type}")
            else:
                logger.warning(f"Failed to save results for {stat_type}")

        conn.close()

        # Return summary
        return {
            stat_type: {
                'total_games': r.total_games,
                'overall_accuracy': r.overall_accuracy,
                'signals': {
                    name: sa.accuracy
                    for name, sa in r.signal_accuracy.items()
                }
            }
            for stat_type, r in results.items()
        }

    except Exception as e:
        logger.error(f"Error in run_validation: {e}")
        conn.close()
        return {}


def train_xgboost(stat_types: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Train XGBoost models per stat type using labeled data from xgboost_training_log.

    Run after populate_actuals to ensure training data is up to date.
    Integrated into the daily pipeline at 3:15 AM.

    Args:
        stat_types: Stat types to train (None = Points, Rebounds, Assists).

    Returns:
        Dict with training metrics per stat type.
    """
    logger.info("Starting XGBoost training...")

    if stat_types is None:
        stat_types = SUPPORTED_STAT_TYPES[:3]  # Points, Rebounds, Assists

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection for XGBoost training")
        return {}

    config = XGBoostConfig()
    outcome_logger = OutcomeLogger(conn)
    results = {}

    # Resolve model directory to absolute path
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

    try:
        for stat_type in stat_types:
            training_data = outcome_logger.get_training_data(
                stat_type=stat_type,
                limit=10000,
            )

            n_samples = len(training_data)
            if n_samples < 30:
                logger.info(f"Skipping {stat_type}: only {n_samples} labeled samples (need 30+)")
                results[stat_type] = {'status': 'skipped', 'n_samples': n_samples}
                continue

            if n_samples < config.min_training_samples:
                logger.warning(f"{stat_type}: {n_samples} samples (below {config.recommended_samples} recommended)")

            metrics = model.train(training_data, stat_type, validation_split=config.validation_split)

            if 'error' in metrics:
                logger.error(f"{stat_type} training failed: {metrics['error']}")
                results[stat_type] = metrics
                continue

            model.save(stat_type)
            metrics['status'] = 'trained'
            results[stat_type] = metrics

            logger.info(
                f"Trained {stat_type}: "
                f"val_accuracy={metrics.get('val_accuracy', 0):.4f}, "
                f"val_logloss={metrics.get('val_logloss', 0):.4f}, "
                f"n={metrics.get('n_train', 0)+metrics.get('n_val', 0)}, "
                f"model={metrics.get('model_type', '?')}"
            )

        conn.close()

    except Exception as e:
        logger.error(f"XGBoost training error: {e}")
        try:
            conn.close()
        except:
            pass

    trained = sum(1 for r in results.values() if r.get('status') == 'trained')
    logger.info(f"XGBoost training complete: {trained}/{len(stat_types)} models trained")
    return results


def update_weights(days: int = 60) -> Dict[str, Any]:
    """
    Update signal weights based on historical performance.

    Run at 3:30 AM on Sundays (weekly).

    Steps:
    1. Run WeightOptimizer for each stat type
    2. Save new weights to signal_weights table
    3. Previous weights marked as expired (valid_until = today)

    Args:
        days: Days of historical data to use

    Returns:
        Dict with new weights per stat type
    """
    logger.info(f"Updating weights using past {days} days...")

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return {}

    try:
        results = optimize_all_weights(
            db_connection=conn,
            days=days,
            stat_types=SUPPORTED_STAT_TYPES[:3],
            save=True,
        )

        conn.close()

        # Return summary
        return {
            stat_type: {
                'overall_accuracy': w.overall_accuracy,
                'sample_size': w.sample_size,
                'weights': w.to_weight_dict(),
            }
            for stat_type, w in results.items()
        }

    except Exception as e:
        logger.error(f"Error in update_weights: {e}")
        conn.close()
        return {}



# ---------------------------------------------------------------------------
# New Signal Engine Jobs
# ---------------------------------------------------------------------------

def run_injury_feed() -> List[Dict[str, Any]]:
    """
    Poll Perplexity API for injury updates and trigger usage redistribution.

    Run every 5 minutes on game days.

    Returns:
        List of newly detected injury update dicts.
    """
    try:
        from src.engine.injury_feed import check_injuries, is_game_day
        if not is_game_day():
            logger.debug("Injury feed: not a game day, skipping")
            return []
        updates = check_injuries()
        if updates:
            logger.info(f"Injury feed: {len(updates)} new updates")
        return updates
    except Exception as e:
        logger.error(f"run_injury_feed failed: {e}")
        return []


def run_projection_engine(target_date: Optional[str] = None) -> int:
    """
    Run daily projection engine to populate projection_outputs table.

    Run at 10 AM ET daily (after ref assignments scraped at 9 AM).

    Args:
        target_date: Date string YYYY-MM-DD (defaults to today)

    Returns:
        Number of projections written.
    """
    try:
        from src.engine.projection_engine import run_daily
        return run_daily(target_date=target_date)
    except Exception as e:
        logger.error(f"run_projection_engine failed: {e}")
        return 0


def run_bayesian_optimizer() -> Dict[str, Any]:
    """
    Weekly job: update signal weights using Thompson-Sampling Bayesian optimizer.

    Run Sunday at midnight.

    Returns:
        Dict of updated signal type → weight info.
    """
    try:
        from src.engine.bayesian_optimizer import update_weights
        results = update_weights()
        logger.info(f"Bayesian optimizer updated {len(results)} signal weights")
        return results
    except Exception as e:
        logger.error(f"run_bayesian_optimizer failed: {e}")
        return {}


def refresh_team_stats(season: str = '2024-25') -> int:
    """
    Refresh team_defense table with current team stats from NBA API.

    Populates pace, def_rating, and opponent allowed stats needed by:
    - Pace Matchup signal (opponent_pace)
    - Def vs Position signal (opponent_def_vs_position)
    - Blowout Risk signal (spread estimation from def ratings)

    Run daily at 1:30 AM (after populate_actuals).

    Args:
        season: NBA season string (e.g., '2024-25')

    Returns:
        Number of teams updated.
    """
    logger.info(f"Refreshing team stats for {season}...")

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return 0

    try:
        from nba_api.stats.endpoints import leaguedashteamstats
        from nba_api.stats.static import teams as nba_teams_static
        import time

        # 1. Fetch advanced stats (pace, def_rating)
        time.sleep(1)
        df_adv = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense='Advanced',
            per_mode_detailed='PerGame'
        ).get_data_frames()[0]

        # 2. Fetch opponent stats (points/rebounds/assists allowed)
        time.sleep(1)
        df_opp = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense='Opponent',
            per_mode_detailed='PerGame'
        ).get_data_frames()[0]

        # Merge on TEAM_ID
        df = df_adv.merge(
            df_opp[['TEAM_ID', 'OPP_PTS', 'OPP_REB', 'OPP_AST', 'OPP_FG3_PCT']],
            on='TEAM_ID',
            how='left'
        )

        # Build team abbreviation map
        all_teams = nba_teams_static.get_teams()
        id_to_abbr = {t['id']: t['abbreviation'] for t in all_teams}

        cursor = conn.cursor()
        updated = 0

        for _, row in df.iterrows():
            team_id = int(row['TEAM_ID'])
            abbr = id_to_abbr.get(team_id, str(row.get('TEAM_NAME', 'UNK'))[:3].upper())
            pace = float(row.get('PACE', row.get('E_PACE', 100.0)))
            def_rtg = float(row.get('DEF_RATING', row.get('E_DEF_RATING', 110.0)))
            opp_pts = float(row.get('OPP_PTS', 110.0))
            opp_reb = float(row.get('OPP_REB', 44.0))
            opp_ast = float(row.get('OPP_AST', 25.0))
            opp_3pt = float(row.get('OPP_FG3_PCT', 0.36))

            cursor.execute("""
                INSERT INTO team_defense (
                    team_id, team_abbr, season, def_rating, pace,
                    opp_pts_allowed, opp_reb_allowed, opp_ast_allowed,
                    opp_3pt_pct_allowed, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (team_id) DO UPDATE SET
                    def_rating = EXCLUDED.def_rating,
                    pace = EXCLUDED.pace,
                    opp_pts_allowed = EXCLUDED.opp_pts_allowed,
                    opp_reb_allowed = EXCLUDED.opp_reb_allowed,
                    opp_ast_allowed = EXCLUDED.opp_ast_allowed,
                    opp_3pt_pct_allowed = EXCLUDED.opp_3pt_pct_allowed,
                    updated_at = NOW()
            """, (team_id, abbr, season, def_rtg, pace, opp_pts, opp_reb, opp_ast, opp_3pt))
            updated += 1

        conn.commit()
        cursor.close()
        conn.close()
        logger.info(f"Updated team_defense for {updated} teams")
        return updated

    except Exception as e:
        logger.error(f"refresh_team_stats failed: {e}")
        try:
            conn.close()
        except:
            pass
        return 0


def populate_game_referees(target_date: Optional[str] = None) -> int:
    """
    Populate games and game_referees tables for completed games.

    Fetches referee assignments from NBA API BoxScoreSummary for each game.
    This data feeds the Referee signal during backtesting.

    Run daily at 2:30 AM (after populate_actuals).

    Args:
        target_date: Date to populate (YYYY-MM-DD), defaults to yesterday.

    Returns:
        Number of games with referee data populated.
    """
    logger.info("Populating game referees...")

    if target_date is None:
        yesterday = datetime.now() - timedelta(days=1)
        target_date = yesterday.strftime('%Y-%m-%d')

    conn = get_db_connection()
    if conn is None:
        logger.error("No database connection")
        return 0

    try:
        from nba_api.stats.endpoints import scoreboardv2
        import time

        time.sleep(1)
        scoreboard = scoreboardv2.ScoreboardV2(game_date=target_date)
        games_df = scoreboard.get_data_frames()[0]

        if games_df.empty:
            logger.info(f"No games found for {target_date}")
            conn.close()
            return 0

        cursor = conn.cursor()
        populated = 0

        for _, game in games_df.iterrows():
            game_id = str(game.get('GAME_ID', ''))
            if not game_id:
                continue

            home_team = str(game.get('HOME_TEAM_ID', ''))
            visitor_team = str(game.get('VISITOR_TEAM_ID', ''))

            # Get team abbreviations
            home_abbr = str(game.get('HOME_ABBREV', game.get('HOME_TEAM_ABBREV', '')))
            away_abbr = str(game.get('AWAY_ABBREV', game.get('VISITOR_TEAM_ABBREV', '')))

            # Insert into games table
            try:
                cursor.execute("""
                    INSERT INTO games (game_id, game_date, home_team, visitor_team)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (game_id) DO NOTHING
                """, (game_id, target_date, home_abbr or home_team, away_abbr or visitor_team))
            except Exception:
                pass  # games table may not exist yet

            # Fetch officials for this game
            try:
                time.sleep(0.8)
                from nba_api.stats.endpoints import boxscoresummaryv2
                summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id)
                officials_df = summary.officials.get_data_frame()

                if officials_df.empty:
                    continue

                for _, ref in officials_df.iterrows():
                    ref_id = int(ref.get('OFFICIAL_ID', 0))
                    first_name = str(ref.get('FIRST_NAME', ''))
                    last_name = str(ref.get('LAST_NAME', ''))
                    jersey = str(ref.get('JERSEY_NUM', ''))

                    if not ref_id:
                        continue

                    # Upsert referee
                    cursor.execute("""
                        INSERT INTO referees (id, first_name, last_name, jersey_number)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            first_name = EXCLUDED.first_name,
                            last_name = EXCLUDED.last_name,
                            jersey_number = EXCLUDED.jersey_number
                    """, (ref_id, first_name, last_name, jersey))

                    # Link to game
                    cursor.execute("""
                        INSERT INTO game_referees (game_id, referee_id, game_date)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (game_id, referee_id) DO NOTHING
                    """, (game_id, ref_id, target_date))

                populated += 1
            except Exception as e:
                logger.debug(f"Could not fetch officials for game {game_id}: {e}")
                continue

        conn.commit()
        cursor.close()
        conn.close()
        logger.info(f"Populated referee data for {populated} games on {target_date}")
        return populated

    except Exception as e:
        logger.error(f"populate_game_referees failed: {e}")
        try:
            conn.close()
        except:
            pass
        return 0


def run_positional_defense_update() -> int:
    """
    Weekly job: refresh positional defense data in team_stats table.

    Run Sunday at 1 AM (after Bayesian optimizer).

    Returns:
        Number of teams updated.
    """
    try:
        from src.signals.positional_defense import update_positional_defense
        return update_positional_defense()
    except Exception as e:
        logger.error(f"run_positional_defense_update failed: {e}")
        return 0


def run_correlation_refresh() -> int:
    """
    Weekly job: recalculate all pairwise player correlations and upsert
    into player_correlations table.

    Run Sunday at 2 AM (after positional defense update).

    Returns:
        Number of correlation pairs processed.
    """
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from correlations.correlation_engine import CorrelationEngine
        engine = CorrelationEngine()
        processed = engine.refresh_all_correlations()
        logger.info(f"Correlation refresh complete: {processed} pairs processed")
        return processed
    except Exception as e:
        logger.error(f"run_correlation_refresh failed: {e}")
        return 0


def run_parlay_builder(target_date: Optional[str] = None, parlay_size: int = 2) -> int:
    """
    Daily job: generate correlated parlay recommendations for today's props.

    Run at 10:30 AM ET (after projection_engine finishes at 10 AM).

    Args:
        target_date: Date string YYYY-MM-DD (defaults to today)
        parlay_size: Number of legs per parlay (default 2)

    Returns:
        Number of parlays written to parlay_results.
    """
    try:
        if target_date is None:
            target_date = datetime.now().strftime('%Y-%m-%d')

        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from correlations.parlay_builder import CorrelatedParlayBuilder
        builder = CorrelatedParlayBuilder()
        parlays = builder.find_optimal_parlays(
            game_date=target_date,
            parlay_size=parlay_size,
            min_ev=0.05,
            max_results=20,
        )
        logger.info(
            f"Parlay builder: {len(parlays)} parlays written for {target_date} "
            f"(size={parlay_size})"
        )
        return len(parlays)
    except Exception as e:
        logger.error(f"run_parlay_builder failed: {e}")
        return 0


def snapshot_lines() -> int:
    """
    Snapshot current PrizePicks lines every 15 minutes for line movement tracking.

    Returns:
        Number of lines snapshotted (0 if no scraper configured).
    """
    scraper_key = os.environ.get("PRIZEPICKS_SCRAPER_KEY", "")
    if not scraper_key:
        logger.debug("PRIZEPICKS_SCRAPER_KEY not set — line snapshot skipped")
        return 0

    try:
        # Leverage the existing PrizePicks sync logic from routes
        # This is a placeholder that integrates with the existing line tracker
        logger.info("Snapshotting PrizePicks lines...")
        return 0  # Actual implementation delegates to existing tracker
    except Exception as e:
        logger.error(f"snapshot_lines failed: {e}")
        return 0


def backfill_data(season: str = '2025-26') -> None:
    """
    Run data backfill for a specific season.
    
    Args:
        season: Season to fetch (e.g. 2025-26)
    """
    logger.info(f"Starting backfill for {season}...")
    try:
        # Import dynamically to avoid circular imports or path issues
        from scripts import backfill_players
        
        # Mock sys.argv for the script
        old_argv = sys.argv
        sys.argv = ['backfill_players.py', '--season', season]
        
        backfill_players.main()
        
        sys.argv = old_argv
        logger.info("Backfill finished")
    except Exception as e:
        logger.error(f"Error running backfill: {e}")


def run_full_pipeline() -> Dict[str, Any]:
    """
    Run full pipeline (for testing/manual runs).

    Runs all steps in sequence:
    1. Populate actuals for yesterday
    2. Run validation
    3. Update weights (if Sunday)
    4. Capture projections for today
    """
    logger.info("Running full pipeline...")
    results = {}

    # Step 0: Refresh team stats (needed by pace, defense, blowout signals)
    results['team_stats_refreshed'] = refresh_team_stats()

    # Step 0.5: Populate referee data for yesterday's games
    results['referees_populated'] = populate_game_referees()

    # Step 1: Populate yesterday's actuals
    results['actuals_updated'] = populate_actuals()

    # Step 2: Run validation
    results['validation'] = run_validation()

    # Step 3: Train XGBoost models
    results['xgboost_training'] = train_xgboost()

    # Step 4: Update weights (only on Sunday)
    if datetime.now().weekday() == 6:  # Sunday
        results['weights'] = update_weights()
    else:
        results['weights'] = "Skipped (not Sunday)"

    # Step 5: Capture today's projections
    results['projections_captured'] = capture_projections()

    logger.info("Full pipeline complete")
    return results


def main():
    """Main entry point for cron jobs."""
    parser = argparse.ArgumentParser(
        description='NBA Prop Backtest Pipeline Cron Jobs',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )

    parser.add_argument(
        'command',
        choices=[
            'capture', 'actuals', 'validate', 'train', 'weights', 'backfill', 'all',
            'injuries', 'projections', 'bayesian', 'positional-defense', 'snapshot',
            'correlations', 'parlays', 'refresh-stats', 'referees',
        ],
        help='Command to run'
    )

    parser.add_argument(
        '--date',
        type=str,
        help='Target date (YYYY-MM-DD)'
    )

    parser.add_argument(
        '--days',
        type=int,
        default=30,
        help='Days for validation/weight calculation'
    )

    parser.add_argument(
        '--size',
        type=int,
        default=2,
        help='Parlay leg count (2-6) for parlays command'
    )

    parser.add_argument(
        '--verbose',
        '-v',
        action='store_true',
        help='Enable verbose logging'
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Run appropriate command
    if args.command == 'capture':
        result = capture_projections(args.date)
        print(f"Captured {result} projections")

    elif args.command == 'actuals':
        result = populate_actuals(args.date)
        print(f"Updated {result} records with actuals")

    elif args.command == 'validate':
        result = run_validation(args.days)
        print(json.dumps(result, indent=2))

    elif args.command == 'train':
        result = train_xgboost()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == 'weights':
        result = update_weights(args.days)
        print(json.dumps(result, indent=2))

    elif args.command == 'all':
        result = run_full_pipeline()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == 'backfill':
        backfill_data()

    elif args.command == 'injuries':
        result = run_injury_feed()
        print(json.dumps(result, indent=2))

    elif args.command == 'projections':
        result = run_projection_engine(args.date)
        print(f"Wrote {result} projections")

    elif args.command == 'bayesian':
        result = run_bayesian_optimizer()
        print(json.dumps(result, indent=2, default=str))

    elif args.command == 'positional-defense':
        result = run_positional_defense_update()
        print(f"Updated {result} teams")

    elif args.command == 'snapshot':
        result = snapshot_lines()
        print(f"Snapshotted {result} lines")

    elif args.command == 'correlations':
        result = run_correlation_refresh()
        print(f"Processed {result} correlation pairs")

    elif args.command == 'parlays':
        size = getattr(args, 'size', 2)
        result = run_parlay_builder(args.date, parlay_size=size)
        print(f"Generated {result} parlay recommendations")

    elif args.command == 'refresh-stats':
        result = refresh_team_stats()
        print(f"Updated {result} teams in team_defense")

    elif args.command == 'referees':
        result = populate_game_referees(args.date)
        print(f"Populated referee data for {result} games")


# ---------------------------------------------------------------------------
# APScheduler integration (used when running as a long-lived process)
# ---------------------------------------------------------------------------

def start_scheduler():
    """
    Start APScheduler with all cron jobs.

    New jobs added:
      - Injury feed: every 5 min on game days
      - Line snapshot: every 15 min
      - Ref assignments: daily 9 AM ET
      - Projection engine: daily 10 AM ET
      - Bayesian optimizer: weekly Sunday midnight
      - Positional defense update: weekly Sunday 1 AM
      - Correlation refresh: weekly Sunday 2 AM
      - Parlay builder: daily 10:30 AM ET
    """
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
        from src.engine.injury_feed import is_game_day
    except ImportError:
        logger.error("apscheduler not installed. Run: pip install apscheduler")
        return

    scheduler = BlockingScheduler(timezone="America/New_York")

    # Existing jobs (capture, actuals, validate, weights) — kept intact
    scheduler.add_job(capture_projections, 'cron', hour=10, minute=0,
                      id='capture_projections', replace_existing=True)
    scheduler.add_job(populate_actuals, 'cron', hour=2, minute=0,
                      id='populate_actuals', replace_existing=True)
    scheduler.add_job(run_validation, 'cron', hour=3, minute=0,
                      id='run_validation', replace_existing=True)
    scheduler.add_job(train_xgboost, 'cron', hour=3, minute=15,
                      id='train_xgboost', replace_existing=True)
    scheduler.add_job(update_weights, 'cron', day_of_week='sun', hour=3, minute=30,
                      id='update_weights_legacy', replace_existing=True)

    # Team stats refresh daily at 1:30 AM (before validation at 3 AM)
    scheduler.add_job(refresh_team_stats, 'cron', hour=1, minute=30,
                      id='refresh_team_stats', replace_existing=True)

    # Referee data daily at 2:30 AM (after actuals at 2 AM)
    scheduler.add_job(populate_game_referees, 'cron', hour=2, minute=30,
                      id='populate_game_referees', replace_existing=True)

    # New Signal Engine jobs
    scheduler.add_job(
        run_injury_feed, 'interval', minutes=5,
        id='injury_feed', replace_existing=True,
    )

    scheduler.add_job(
        snapshot_lines, 'interval', minutes=15,
        id='snapshot_lines', replace_existing=True,
    )

    # Ref assignments daily 9 AM
    try:
        from src.ref_foul_signal import scrape_assignments
        scheduler.add_job(scrape_assignments, 'cron', hour=9, minute=0,
                          id='ref_assignments', replace_existing=True)
    except Exception:
        logger.warning("ref_foul_signal.scrape_assignments not available")

    # Projection engine daily 10 AM
    scheduler.add_job(run_projection_engine, 'cron', hour=10, minute=0,
                      id='projection_engine', replace_existing=True)

    # Bayesian optimizer weekly Sunday midnight
    scheduler.add_job(run_bayesian_optimizer, 'cron',
                      day_of_week='sun', hour=0, minute=0,
                      id='bayesian_optimizer', replace_existing=True)

    # Positional defense update weekly Sunday 1 AM
    scheduler.add_job(run_positional_defense_update, 'cron',
                      day_of_week='sun', hour=1, minute=0,
                      id='positional_defense_update', replace_existing=True)

    # Correlation refresh weekly Sunday 2 AM
    scheduler.add_job(run_correlation_refresh, 'cron',
                      day_of_week='sun', hour=2, minute=0,
                      id='correlation_refresh', replace_existing=True)

    # Parlay builder daily 10:30 AM (after projection engine at 10 AM)
    scheduler.add_job(run_parlay_builder, 'cron', hour=10, minute=30,
                      id='parlay_builder', replace_existing=True)

    logger.info("Starting scheduler with all jobs...")
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped")


if __name__ == '__main__':
    main()