"""
Projection Engine

Combines baseline + signal delta → final projection with confidence tier,
Kelly stake, and writes to projection_outputs table.

Daily job entry: projection_engine.run_daily()
"""

import logging
import os
import json
from typing import Dict, Any, Optional, List
from datetime import datetime

from src.signals.signal_engine import SignalEngine, GameContext

logger = logging.getLogger(__name__)

# PrizePicks 2-leg payout multiplier (2-pick power play = 3x, use 0.85 for
# conservative effective b used in Kelly)
PRIZEPICKS_PAYOUT = 0.85


def _get_db_connection():
    try:
        import psycopg2
        db_url = os.environ.get("DATABASE_URL")
        if db_url:
            return psycopg2.connect(db_url)
        return psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", 5432)),
            database=os.environ.get("DB_NAME", "hoopstats"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", ""),
        )
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None


def _compute_baseline(player_id: str, prop_type: str, conn) -> Optional[float]:
    """
    Pace-adjusted season average from player_advanced_stats (or players table fallback).

    Returns float baseline or None if insufficient data.
    """
    stat_col_map = {
        "Points": "pts",
        "Rebounds": "reb",
        "Assists": "ast",
        "3-Pointers Made": "fg3m",
        "Steals": "stl",
        "Blocks": "blk",
        "Turnovers": "tov",
    }
    # Combo stats: sum of components
    combo_map = {
        "Pts+Rebs": ["pts", "reb"],
        "Pts+Asts": ["pts", "ast"],
        "Rebs+Asts": ["reb", "ast"],
        "Pts+Rebs+Asts": ["pts", "reb", "ast"],
        "Blks+Stls": ["blk", "stl"],
    }

    if conn is None:
        return None

    try:
        cursor = conn.cursor()

        if prop_type in combo_map:
            cols = combo_map[prop_type]
            # Pull from players.season_averages JSONB
            cursor.execute(
                "SELECT season_averages FROM players WHERE id = %s", (player_id,)
            )
            row = cursor.fetchone()
            cursor.close()
            if row and row[0]:
                avgs = row[0] if isinstance(row[0], dict) else json.loads(row[0])
                return sum(float(avgs.get(c, 0)) for c in cols)
            return None

        stat_key = stat_col_map.get(prop_type)
        if not stat_key:
            return None

        # Try player_advanced_stats first (pace-adjusted)
        cursor.execute(
            f"""
            SELECT AVG(pas.pace / NULLIF(t.pace, 0) * p.season_averages->>'{stat_key}')
            FROM player_advanced_stats pas
            JOIN players p ON pas.player_id = p.id
            JOIN team_stats t ON t.team_id = (
                SELECT team FROM players WHERE id = %s LIMIT 1
            ) AND t.season = '2025-26'
            WHERE pas.player_id = %s
              AND pas.game_date >= NOW() - INTERVAL '30 days'
            LIMIT 1
            """,
            (player_id, player_id),
        )
        row = cursor.fetchone()
        if row and row[0]:
            cursor.close()
            return float(row[0])

        # Fallback: plain season average from players table
        cursor.execute(
            "SELECT season_averages FROM players WHERE id = %s", (player_id,)
        )
        row = cursor.fetchone()
        cursor.close()
        if row and row[0]:
            avgs = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            val = avgs.get(stat_key)
            return float(val) if val is not None else None
    except Exception as e:
        logger.warning(f"Baseline lookup failed for {player_id}/{prop_type}: {e}")

    return None


def _confidence_tier(aligned_signals: int, edge_pct: float, conflict: bool) -> str:
    """Determine confidence tier from signal count, edge, and conflict flag."""
    if conflict:
        return "SKIP"
    if aligned_signals >= 3 and edge_pct > 8.0:
        return "SMASH"
    if aligned_signals >= 2 and 5.0 <= edge_pct <= 8.0:
        return "STRONG"
    if aligned_signals >= 1 and 3.0 <= edge_pct < 5.0:
        return "LEAN"
    return "SKIP"


def _kelly_stake(edge_pct: float, payout: float = PRIZEPICKS_PAYOUT) -> float:
    """
    Fractional Kelly criterion.

    f = (b*p - q) / b
    where:
        b = net payout per unit (0.85)
        p = model hit probability (derived from edge)
        q = 1 - p
    """
    # Convert edge% to hit probability
    # Assume fair probability = 0.5 (no-vig PrizePicks)
    # edge_pct / 100 is the model's advantage over the line
    p = max(0.01, min(0.99, 0.5 + edge_pct / 200))
    q = 1 - p
    b = payout
    f = (b * p - q) / b
    # Apply quarter-Kelly for bankroll safety
    f_quarter = max(0.0, f / 4)
    return round(f_quarter, 4)


def project_player(
    player_id: str,
    game_date: str,
    prop_type: str,
    prizepicks_line: float,
    game_context_extra: Dict[str, Any],
    signal_engine: SignalEngine,
    conn,
) -> Optional[Dict[str, Any]]:
    """
    Generate a single projection for one player/prop/game.

    Returns a dict matching the projection_outputs schema, or None on failure.
    """
    baseline = _compute_baseline(player_id, prop_type, conn)
    if baseline is None or baseline == 0:
        logger.debug(f"No baseline for {player_id}/{prop_type}, skipping")
        return None

    team_id = game_context_extra.get("team_id", "")
    opp_team_id = game_context_extra.get("opp_team_id", "")

    ctx = GameContext(
        player_id=player_id,
        team_id=team_id,
        opp_team_id=opp_team_id,
        game_date=game_date,
        prop_type=prop_type,
        prizepicks_line=prizepicks_line,
        absent_players=game_context_extra.get("absent_players", []),
        referee_crew=game_context_extra.get("referee_crew", []),
        extra=game_context_extra,
    )

    engine_result = signal_engine.run(ctx)

    # Final projection: baseline * (1 + delta)
    signal_delta = engine_result.weighted_delta
    final = baseline * (1 + signal_delta)
    final = round(final, 2)

    # Edge
    edge_pct = round((final - prizepicks_line) / prizepicks_line * 100, 2) if prizepicks_line else 0.0

    # Aligned signals
    over_count = sum(1 for s in engine_result.signals_fired if s["direction"] == "OVER")
    under_count = sum(1 for s in engine_result.signals_fired if s["direction"] == "UNDER")
    aligned_count = max(over_count, under_count)

    tier = _confidence_tier(aligned_count, abs(edge_pct), engine_result.conflict_detected)
    kelly = _kelly_stake(abs(edge_pct)) if tier != "SKIP" else 0.0

    return {
        "player_id": player_id,
        "game_date": game_date,
        "prop_type": prop_type,
        "baseline_projection": round(baseline, 2),
        "signal_delta": round(signal_delta, 4),
        "final_projection": final,
        "prizepicks_line": prizepicks_line,
        "edge_pct": edge_pct,
        "confidence_tier": tier,
        "kelly_stake": kelly,
        "signals_fired": engine_result.signals_fired,
        "direction": engine_result.direction,
    }


def _save_projection(projection: Dict[str, Any], cursor) -> bool:
    """Upsert a projection into projection_outputs."""
    try:
        cursor.execute(
            """
            INSERT INTO projection_outputs
                (player_id, game_date, prop_type, baseline_projection,
                 signal_delta, final_projection, prizepicks_line,
                 edge_pct, confidence_tier, kelly_stake, signals_fired, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT DO NOTHING
            """,
            (
                projection["player_id"],
                projection["game_date"],
                projection["prop_type"],
                projection["baseline_projection"],
                projection["signal_delta"],
                projection["final_projection"],
                projection["prizepicks_line"],
                projection["edge_pct"],
                projection["confidence_tier"],
                projection["kelly_stake"],
                json.dumps(projection["signals_fired"]),
            ),
        )
        return True
    except Exception as e:
        logger.warning(f"Could not save projection: {e}")
        return False


def run_daily(target_date: Optional[str] = None, db_conn=None) -> int:
    """
    Daily job (10 AM ET): generate projections for all today's PrizePicks lines.

    Args:
        target_date: Date string YYYY-MM-DD (defaults to today)
        db_conn: Optional existing connection

    Returns:
        Number of projections written to projection_outputs
    """
    if target_date is None:
        target_date = datetime.now().strftime("%Y-%m-%d")

    conn = db_conn or _get_db_connection()
    if conn is None:
        logger.error("run_daily: no DB connection")
        return 0

    own_conn = db_conn is None
    engine = SignalEngine(db_conn=conn)
    written = 0

    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT pdl.prizepicks_player_id, pdl.player_name, pdl.team,
                   pdl.stat_type, pdl.opening_line, pdl.opponent,
                   p.position, p.season_averages
            FROM prizepicks_daily_lines pdl
            LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
            WHERE pdl.game_date = %s
              AND pdl.opening_line IS NOT NULL
            """,
            (target_date,),
        )
        rows = cursor.fetchall()
        columns = [d[0] for d in cursor.description]
        logger.info(f"run_daily: processing {len(rows)} lines for {target_date}")

        for row in rows:
            data = dict(zip(columns, row))
            player_id = str(data.get("prizepicks_player_id") or data.get("player_name", ""))
            prop_type = data.get("stat_type", "Points")
            line = float(data.get("opening_line") or 0)
            if line <= 0:
                continue

            extra = {
                "team_id": data.get("team", ""),
                "opp_team_id": data.get("opponent", ""),
                "position": data.get("position", ""),
                "season_averages": data.get("season_averages") or {},
            }

            proj = project_player(
                player_id=player_id,
                game_date=target_date,
                prop_type=prop_type,
                prizepicks_line=line,
                game_context_extra=extra,
                signal_engine=engine,
                conn=conn,
            )

            if proj and _save_projection(proj, cursor):
                written += 1

        conn.commit()
        cursor.close()
        logger.info(f"run_daily complete: {written} projections written")

    except Exception as e:
        logger.error(f"run_daily failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        if own_conn:
            conn.close()

    return written


def get_today_projections(
    game_date: Optional[str] = None,
    db_conn=None,
) -> List[Dict[str, Any]]:
    """
    Fetch today's projections from projection_outputs, sorted by edge_pct DESC.
    """
    if game_date is None:
        game_date = datetime.now().strftime("%Y-%m-%d")

    conn = db_conn or _get_db_connection()
    if conn is None:
        return []

    own_conn = db_conn is None
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT po.*, p.player_name
            FROM projection_outputs po
            LEFT JOIN players p ON po.player_id = p.id
            WHERE po.game_date = %s
            ORDER BY ABS(po.edge_pct) DESC
            """,
            (game_date,),
        )
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        cursor.close()
        return [dict(zip(cols, row)) for row in rows]
    except Exception as e:
        logger.error(f"get_today_projections failed: {e}")
        return []
    finally:
        if own_conn:
            conn.close()
