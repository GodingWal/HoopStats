"""
Injury Feed

Polls Perplexity API every 5 minutes on game days for NBA injury updates.
Cross-references newly listed players against today's PrizePicks lines and
triggers UsageRedistributionSignal for teammates.

Entry point: check_injuries()
"""

import logging
import os
import json
import re
from typing import Dict, Any, List, Optional
from datetime import datetime, date

import requests

logger = logging.getLogger(__name__)
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL

PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions"
PERPLEXITY_MODEL = "sonar"
INJURY_PROMPT = (
    "NBA injury updates last 30 minutes. "
    "Return ONLY valid JSON, no markdown, no explanation. "
    'Format: [{"player_name": "...", "team": "...", "status": "out|questionable|probable|gtd", '
    '"source_time": "HH:MM"}]'
)


def _get_db_connection():
    try:
        return _shared_get_connection()
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None

def _call_perplexity(api_key: str) -> List[Dict[str, Any]]:
    """
    Call Perplexity API and parse injury JSON response.

    Returns list of injury dicts, empty list on failure.
    """
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": PERPLEXITY_MODEL,
        "messages": [{"role": "user", "content": INJURY_PROMPT}],
    }

    try:
        response = requests.post(
            PERPLEXITY_API_URL, json=payload, headers=headers, timeout=30
        )
        response.raise_for_status()
        data = response.json()

        content = data["choices"][0]["message"]["content"]

        # Strip markdown code fences if present
        content = re.sub(r"```(?:json)?", "", content).strip()

        injuries = json.loads(content)
        if isinstance(injuries, list):
            return injuries
        logger.warning(f"Perplexity returned non-list JSON: {type(injuries)}")
        return []

    except requests.exceptions.HTTPError as e:
        logger.error(f"Perplexity HTTP error: {e}")
    except json.JSONDecodeError as e:
        logger.error(f"Perplexity JSON parse error: {e}")
    except Exception as e:
        logger.error(f"Perplexity call failed: {e}")

    return []


def _get_todays_prizepicks_players(conn, game_date: str) -> Dict[str, Dict[str, Any]]:
    """
    Return a dict of {lower_player_name: row} for today's PrizePicks lines.
    """
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT player_name, team, stat_type, opening_line
            FROM prizepicks_daily_lines
            WHERE game_date = %s
            """,
            (game_date,),
        )
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
        cursor.close()
        return {row[0].lower(): dict(zip(cols, row)) for row in rows}
    except Exception as e:
        logger.error(f"Could not fetch PrizePicks lines: {e}")
        return {}


def _find_teammates(team: str, conn, game_date: str) -> List[str]:
    """Return player_ids of teammates who have PrizePicks lines today."""
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT DISTINCT p.id
            FROM players p
            JOIN prizepicks_daily_lines pdl ON LOWER(p.player_name) = LOWER(pdl.player_name)
            WHERE LOWER(p.team) = LOWER(%s)
              AND pdl.game_date = %s
            """,
            (team, game_date),
        )
        rows = cursor.fetchall()
        cursor.close()
        return [row[0] for row in rows]
    except Exception as e:
        logger.warning(f"Could not fetch teammates: {e}")
        return []


def _write_injury_signal(
    conn,
    player_id: str,
    player_name: str,
    game_date: str,
    signal_strength: str,
    model_projection: Optional[float],
    prizepicks_line: Optional[float],
) -> None:
    """Log injury alpha signal to signal_results table."""
    try:
        edge_pct = None
        if model_projection and prizepicks_line:
            edge_pct = round((model_projection - prizepicks_line) / prizepicks_line * 100, 2)
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO signal_results
                (signal_type, signal_strength, player_id, game_date, prop_type,
                 model_projection, prizepicks_line, edge_pct, direction, created_at)
            VALUES ('injury_alpha', %s, %s, %s, 'usage_boost',
                    %s, %s, %s, 'OVER', NOW())
            """,
            (signal_strength, player_id, game_date, model_projection, prizepicks_line, edge_pct),
        )
        conn.commit()
        cursor.close()
    except Exception as e:
        logger.warning(f"Could not write injury signal: {e}")
        try:
            conn.rollback()
        except Exception:
            pass


def check_injuries(db_conn=None) -> List[Dict[str, Any]]:
    """
    Main entry point: poll Perplexity, cross-reference lines, trigger signals.

    Called every 5 minutes on game days via scheduler.

    Returns:
        List of injury update dicts that were newly detected.
    """
    api_key = os.environ.get("PERPLEXITY_API_KEY", "")
    if not api_key:
        logger.warning("PERPLEXITY_API_KEY not set — injury feed disabled")
        return []

    game_date = datetime.now().strftime("%Y-%m-%d")

    conn = db_conn or _get_db_connection()
    if conn is None:
        logger.error("check_injuries: no DB connection")
        return []

    own_conn = db_conn is None
    newly_detected: List[Dict[str, Any]] = []

    try:
        # 1. Fetch injury updates from Perplexity
        injuries = _call_perplexity(api_key)
        logger.info(f"Perplexity returned {len(injuries)} injury items")

        if not injuries:
            return []

        # 2. Get today's PrizePicks lines for cross-reference
        pp_players = _get_todays_prizepicks_players(conn, game_date)

        for injury in injuries:
            player_name = injury.get("player_name", "")
            team = injury.get("team", "")
            status = injury.get("status", "").lower()

            if not player_name or status not in ("out", "gtd", "questionable"):
                continue

            # Only care about players on PrizePicks today
            if player_name.lower() not in pp_players:
                continue

            logger.info(f"Injury alpha: {player_name} ({team}) status={status}")

            # 3. Find teammates with lines and trigger usage redistribution
            teammates = _find_teammates(team, conn, game_date)
            for teammate_id in teammates:
                # Attempt usage redistribution projection boost
                try:
                    from src.signals.injury_alpha import InjuryAlphaSignal
                    signal = InjuryAlphaSignal()
                    result = signal.calculate(
                        player_id=teammate_id,
                        game_date=game_date,
                        stat_type="Points",
                        context={
                            "absent_players": [player_name],
                            "team": team,
                        },
                    )
                    if result.fired:
                        _write_injury_signal(
                            conn,
                            player_id=teammate_id,
                            player_name=player_name,
                            game_date=game_date,
                            signal_strength="HIGH" if abs(result.adjustment) > 0.1 else "MEDIUM",
                            model_projection=None,
                            prizepicks_line=None,
                        )
                        logger.info(
                            f"  Injury alpha fired for teammate {teammate_id}: "
                            f"adj={result.adjustment:.3f}"
                        )
                except Exception as e:
                    logger.warning(f"Injury alpha signal failed for {teammate_id}: {e}")

            newly_detected.append({
                "player_name": player_name,
                "team": team,
                "status": status,
                "source_time": injury.get("source_time", ""),
                "teammates_affected": len(teammates),
            })

    except Exception as e:
        logger.error(f"check_injuries failed: {e}")
    finally:
        if own_conn:
            conn.close()

    if newly_detected:
        logger.info(f"Injury feed: {len(newly_detected)} new updates processed")

    return newly_detected


def is_game_day() -> bool:
    """
    Check if today is likely an NBA game day.

    Simple heuristic: NBA games typically run Oct–June, excluding July–September.
    The scheduler calls this to gate the injury feed job.
    """
    today = date.today()
    # No games in July-September
    if today.month in (7, 8, 9):
        return False
    # All-Star break ~mid-February: skip Feb 13-19 (rough approximation)
    if today.month == 2 and 13 <= today.day <= 19:
        return False
    return True
