#!/usr/bin/env python3
"""
Line Snapshot Capture Script

Captures current PrizePicks lines from prizepicks_daily_lines into line_snapshots
every 30 minutes. Detects and logs significant line movements.

Usage:
    python3 capture_lines.py
    
Designed to run via cron every 30 minutes during game hours (10AM-11PM ET).
"""

import os
import sys
import logging
from datetime import datetime, date
from decimal import Decimal

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('capture_lines')

# Movement thresholds
MOVEMENT_LOG_THRESHOLD = 0.5   # Log movements > 0.5 units
SHARP_MOVE_THRESHOLD = 1.0     # Sharp money indicator
STEAM_MOVE_THRESHOLD = 2.0     # Steam move indicator


def get_db_connection():
    """Get database connection from DATABASE_URL env var."""
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        raise ValueError("DATABASE_URL environment variable not set")
    return psycopg2.connect(db_url)


def capture_current_lines(conn):
    """
    Read current lines from prizepicks_daily_lines and insert snapshots
    into line_snapshots table.
    
    Returns: number of snapshots inserted
    """
    today = date.today()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # Get current lines for today's games
    cursor.execute("""
        SELECT prizepicks_player_id, player_name, stat_type, game_date, opening_line
        FROM prizepicks_daily_lines
        WHERE game_date = %s
        AND opening_line IS NOT NULL
    """, (today,))
    
    rows = cursor.fetchall()
    if not rows:
        logger.info(f"No lines found for {today}")
        return 0
    
    inserted = 0
    for row in rows:
        try:
            cursor.execute("""
                INSERT INTO line_snapshots (player_id, player_name, stat_type, game_date, line_value, source)
                VALUES (%s, %s, %s, %s, %s, 'prizepicks')
            """, (
                row['prizepicks_player_id'],
                row['player_name'],
                row['stat_type'],
                row['game_date'],
                row['opening_line']
            ))
            inserted += 1
        except Exception as e:
            logger.warning(f"Failed to insert snapshot for {row['player_name']}: {e}")
            continue
    
    conn.commit()
    logger.info(f"Captured {inserted} line snapshots for {today}")
    return inserted


def detect_movements(conn):
    """
    Compare current snapshot to previous snapshot and detect significant movements.
    Also updates prizepicks_daily_lines with movement data.
    
    Returns: list of detected movements
    """
    today = date.today()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    # Get the two most recent capture times for today
    cursor.execute("""
        SELECT DISTINCT captured_at 
        FROM line_snapshots 
        WHERE game_date = %s 
        ORDER BY captured_at DESC 
        LIMIT 2
    """, (today,))
    
    capture_times = cursor.fetchall()
    if len(capture_times) < 2:
        logger.info("Not enough snapshots yet to detect movements")
        return []
    
    current_time = capture_times[0]['captured_at']
    previous_time = capture_times[1]['captured_at']
    
    # Compare current vs previous snapshots
    cursor.execute("""
        SELECT 
            c.player_id,
            c.player_name,
            c.stat_type,
            c.line_value as current_line,
            p.line_value as previous_line,
            (c.line_value - p.line_value) as movement,
            c.captured_at as current_time,
            p.captured_at as previous_time
        FROM line_snapshots c
        JOIN line_snapshots p 
            ON c.player_id = p.player_id 
            AND c.stat_type = p.stat_type 
            AND c.game_date = p.game_date
        WHERE c.game_date = %s
        AND c.captured_at = %s
        AND p.captured_at = %s
        AND c.line_value != p.line_value
    """, (today, current_time, previous_time))
    
    movements = cursor.fetchall()
    significant_moves = []
    
    for m in movements:
        abs_move = abs(float(m['movement']))
        
        if abs_move >= MOVEMENT_LOG_THRESHOLD:
            move_type = 'NORMAL'
            if abs_move >= STEAM_MOVE_THRESHOLD:
                move_type = 'STEAM'
            elif abs_move >= SHARP_MOVE_THRESHOLD:
                move_type = 'SHARP'
            
            direction = 'UP' if float(m['movement']) > 0 else 'DOWN'
            
            significant_moves.append({
                'player_id': m['player_id'],
                'player_name': m['player_name'],
                'stat_type': m['stat_type'],
                'previous_line': float(m['previous_line']),
                'current_line': float(m['current_line']),
                'movement': float(m['movement']),
                'direction': direction,
                'move_type': move_type,
            })
            
            logger.info(
                f"[{move_type}] {m['player_name']} {m['stat_type']}: "
                f"{m['previous_line']} -> {m['current_line']} ({direction} {abs_move})"
            )
    
    # Update prizepicks_daily_lines with movement tracking data
    _update_daily_lines_movement(conn, today)
    
    return significant_moves


def _update_daily_lines_movement(conn, game_date):
    """
    Update prizepicks_daily_lines with aggregated movement data from snapshots.
    Sets closing_line, total_movement, net_movement, num_movements, high_line, low_line.
    """
    cursor = conn.cursor()
    
    cursor.execute("""
        UPDATE prizepicks_daily_lines pdl
        SET 
            closing_line = snap.latest_line,
            closing_captured_at = snap.latest_time,
            total_movement = snap.total_move,
            net_movement = snap.net_move,
            num_movements = snap.n_moves,
            high_line = snap.max_line,
            low_line = snap.min_line,
            updated_at = NOW()
        FROM (
            SELECT 
                player_id,
                stat_type,
                game_date,
                -- Latest line value
                (ARRAY_AGG(line_value ORDER BY captured_at DESC))[1] as latest_line,
                MAX(captured_at) as latest_time,
                -- Movement stats
                MAX(line_value) as max_line,
                MIN(line_value) as min_line,
                MAX(line_value) - MIN(line_value) as total_move,
                (ARRAY_AGG(line_value ORDER BY captured_at DESC))[1] - 
                (ARRAY_AGG(line_value ORDER BY captured_at ASC))[1] as net_move,
                -- Count distinct line values (movements = changes - 1)
                GREATEST(COUNT(DISTINCT line_value) - 1, 0) as n_moves
            FROM line_snapshots
            WHERE game_date = %s
            GROUP BY player_id, stat_type, game_date
        ) snap
        WHERE pdl.prizepicks_player_id = snap.player_id
        AND pdl.stat_type = snap.stat_type
        AND pdl.game_date = snap.game_date
    """, (game_date,))
    
    updated = cursor.rowcount
    conn.commit()
    logger.info(f"Updated {updated} daily lines with movement data")
    return updated


def get_line_history(conn, player_id, stat_type, game_date):
    """
    Get full line history for a player/stat/date combo.
    Used by the line_movement signal for sharp move detection.
    
    Returns: list of dicts with line_value and captured_at
    """
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cursor.execute("""
        SELECT line_value, captured_at
        FROM line_snapshots
        WHERE player_id = %s AND stat_type = %s AND game_date = %s
        ORDER BY captured_at ASC
    """, (player_id, stat_type, game_date))
    
    return [dict(row) for row in cursor.fetchall()]


def get_todays_movements(conn):
    """
    Get summary of all movements detected today.
    Used by API endpoint.
    """
    today = date.today()
    cursor = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    
    cursor.execute("""
        SELECT 
            ls.player_id,
            ls.player_name,
            ls.stat_type,
            ls.game_date,
            MIN(ls.line_value) as low_line,
            MAX(ls.line_value) as high_line,
            (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1] as opening_line,
            (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] as current_line,
            (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] - 
            (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1] as net_movement,
            MAX(ls.line_value) - MIN(ls.line_value) as total_range,
            COUNT(DISTINCT ls.line_value) - 1 as num_changes,
            MIN(ls.captured_at) as first_seen,
            MAX(ls.captured_at) as last_updated,
            CASE 
                WHEN ABS((ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] - 
                     (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1]) >= 2.0 THEN 'STEAM'
                WHEN ABS((ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] - 
                     (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1]) >= 1.0 THEN 'SHARP'
                WHEN ABS((ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] - 
                     (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1]) >= 0.5 THEN 'NOTABLE'
                ELSE 'STABLE'
            END as movement_type
        FROM line_snapshots ls
        WHERE ls.game_date = %s
        GROUP BY ls.player_id, ls.player_name, ls.stat_type, ls.game_date
        HAVING COUNT(DISTINCT ls.line_value) > 1
        ORDER BY ABS((ARRAY_AGG(ls.line_value ORDER BY ls.captured_at DESC))[1] - 
                     (ARRAY_AGG(ls.line_value ORDER BY ls.captured_at ASC))[1]) DESC
    """, (today,))
    
    return [dict(row) for row in cursor.fetchall()]


def main():
    """Main entry point - capture lines and detect movements."""
    logger.info("=" * 60)
    logger.info(f"Line capture started at {datetime.now()}")
    
    try:
        conn = get_db_connection()
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        sys.exit(1)
    
    try:
        # Step 1: Capture current lines
        captured = capture_current_lines(conn)
        
        # Step 2: Detect movements vs previous snapshot
        movements = detect_movements(conn)
        
        # Step 3: Summary
        sharp_count = sum(1 for m in movements if m['move_type'] in ('SHARP', 'STEAM'))
        steam_count = sum(1 for m in movements if m['move_type'] == 'STEAM')
        
        logger.info(
            f"Summary: {captured} lines captured, {len(movements)} movements detected "
            f"({sharp_count} sharp, {steam_count} steam)"
        )
        
    except Exception as e:
        logger.error(f"Error during line capture: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()
    
    logger.info("Line capture completed")


if __name__ == '__main__':
    main()
