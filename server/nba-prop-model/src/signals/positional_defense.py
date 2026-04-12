"""
Positional Defense Signal

Compares a player's position to opponent's positional defense rank.
Bottom-10 defending the player's position → +1 multiplier (favor OVER).
Top-10 defending the player's position   → -1 multiplier (favor UNDER).
"""

import logging
import os
from typing import Dict, Any, Optional
from datetime import datetime

from .base import BaseSignal, SignalResult, registry

logger = logging.getLogger(__name__)
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL

# Position normalization map
POSITION_MAP = {
    "PG": "pg", "SG": "sg", "SF": "sf", "PF": "pf", "C": "c",
    "G": "pg", "F": "sf", "G-F": "sg", "F-C": "pf", "C-F": "c",
}

# Column names in team_stats table keyed by normalized position
POSITION_DEF_COLUMNS = {
    "pg": "def_vs_pg",
    "sg": "def_vs_sg",
    "sf": "def_vs_sf",
    "pf": "def_vs_pf",
    "c":  "def_vs_c",
}

# Stat types this signal applies to (scoring-focused)
POSITIONAL_DEF_STAT_TYPES = [
    "Points", "Rebounds", "Assists", "3-Pointers Made",
    "Pts+Rebs", "Pts+Asts", "Pts+Rebs+Asts",
]


def _get_db_connection():
    try:
        return _shared_get_connection()
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None

def update_positional_defense(season: Optional[str] = None) -> int:
    """
    Weekly refresh: pull positional defense data and upsert into team_stats.

    Uses the nba_api BoxScoreDefensiveSummaryV2 or similar endpoint.
    Falls back to estimating from available game logs if the endpoint is unavailable.

    Returns:
        Number of team rows upserted.
    """
    if season is None:
        now = datetime.now()
        year = now.year
        season = f"{year}-{str(year + 1)[2:]}" if now.month >= 10 else f"{year - 1}-{str(year)[2:]}"

    logger.info(f"Updating positional defense for season {season}")

    conn = _get_db_connection()
    if conn is None:
        logger.error("Cannot update positional defense — no DB connection")
        return 0

    upserted = 0
    try:
        from nba_api.stats.endpoints import LeagueDashPtTeamDefend
        import time

        positions = ["Guard", "Wing", "Big"]
        pos_to_col = {"Guard": ("def_vs_pg", "def_vs_sg"), "Wing": ("def_vs_sf",), "Big": ("def_vs_pf", "def_vs_c")}

        # Fetch pts-per-possession allowed by position
        team_data: Dict[str, Dict[str, float]] = {}

        for defense_category in positions:
            try:
                time.sleep(1)  # NBA API rate limit
                result = LeagueDashPtTeamDefend(
                    season=season,
                    defense_category=defense_category,
                    per_mode_simple="PerGame",
                ).get_data_frames()[0]

                for _, row in result.iterrows():
                    tid = str(row.get("TEAM_ABBREVIATION", row.get("TEAM_ID", "")))
                    pts_allowed = float(row.get("FREQ_PTS", row.get("PTS_PER_ATTEMPT", 0)) or 0)
                    if tid not in team_data:
                        team_data[tid] = {}
                    for col in pos_to_col[defense_category]:
                        team_data[tid][col] = pts_allowed

            except Exception as e:
                logger.warning(f"Could not fetch {defense_category} defense: {e}")

        cursor = conn.cursor()
        for team_id, cols in team_data.items():
            if not cols:
                continue
            cursor.execute(
                """
                INSERT INTO team_stats (team_id, season, def_vs_pg, def_vs_sg, def_vs_sf, def_vs_pf, def_vs_c, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (team_id, season) DO UPDATE SET
                    def_vs_pg = COALESCE(EXCLUDED.def_vs_pg, team_stats.def_vs_pg),
                    def_vs_sg = COALESCE(EXCLUDED.def_vs_sg, team_stats.def_vs_sg),
                    def_vs_sf = COALESCE(EXCLUDED.def_vs_sf, team_stats.def_vs_sf),
                    def_vs_pf = COALESCE(EXCLUDED.def_vs_pf, team_stats.def_vs_pf),
                    def_vs_c  = COALESCE(EXCLUDED.def_vs_c,  team_stats.def_vs_c),
                    updated_at = NOW()
                """,
                (
                    team_id, season,
                    cols.get("def_vs_pg"), cols.get("def_vs_sg"),
                    cols.get("def_vs_sf"), cols.get("def_vs_pf"), cols.get("def_vs_c"),
                ),
            )
            upserted += 1

        conn.commit()
        cursor.close()
        logger.info(f"Upserted positional defense for {upserted} teams")
    except Exception as e:
        logger.error(f"update_positional_defense failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        conn.close()

    return upserted


class PositionalDefenseSignal(BaseSignal):
    """
    Signal: compare player position to opponent's positional defense rank.

    Reads from team_stats table (def_vs_pg, def_vs_sg, etc.).
    If no DB data is available, falls back to context['opp_positional_def'].

    Context keys used:
        - position (str): Player's position (e.g. 'PG', 'SF')
        - opp_team_id (str): Opponent team abbreviation/ID
        - season (str, optional): Season string, defaults to current season
        - opp_positional_def (dict, optional): fallback {pos: pts_allowed}
    """

    name = "positional_defense"
    description = "Opponent positional defense rank vs player's position"
    stat_types = POSITIONAL_DEF_STAT_TYPES
    default_confidence = 0.55

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any],
    ) -> SignalResult:
        raw_pos = context.get("position", "")
        pos = POSITION_MAP.get(raw_pos.upper(), "")
        if not pos:
            return self._create_neutral_result()

        opp_team_id = context.get("opp_team_id", "")
        if not opp_team_id:
            return self._create_neutral_result()

        def_rating = self._lookup_def_rating(pos, opp_team_id, game_date, context)
        if def_rating is None:
            return self._create_neutral_result()

        league_avg, rank_context = self._get_league_avg_and_rank(pos, game_date, opp_team_id)
        if league_avg is None or league_avg == 0:
            return self._create_neutral_result()

        # Relative performance vs league average
        relative = (def_rating - league_avg) / league_avg  # positive = team allows MORE

        # Bottom-10 (allows a lot) → OVER signal; Top-10 (stingy) → UNDER signal
        if relative >= 0.05:  # ~5%+ above average = weak defender
            direction = "OVER"
            adjustment = relative * 2.0   # scale to projection delta
            confidence = min(0.75, 0.50 + abs(relative) * 0.5)
        elif relative <= -0.05:  # stingy defender
            direction = "UNDER"
            adjustment = relative * 2.0   # negative delta
            confidence = min(0.75, 0.50 + abs(relative) * 0.5)
        else:
            return self._create_neutral_result()

        return self._create_result(
            adjustment=round(adjustment, 4),
            direction=direction,
            confidence=round(confidence, 3),
            metadata={
                "position": pos,
                "opp_team_id": opp_team_id,
                "def_rating": def_rating,
                "league_avg": league_avg,
                "relative_pct": round(relative * 100, 2),
                "rank_context": rank_context,
            },
            sample_size=rank_context.get("sample_size", 0),
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _lookup_def_rating(
        self,
        pos: str,
        opp_team_id: str,
        game_date: str,
        context: Dict[str, Any],
    ) -> Optional[float]:
        """Try DB first, fall back to context dict."""
        col = POSITION_DEF_COLUMNS.get(pos)
        if not col:
            return None

        # DB lookup
        try:
            conn = _get_db_connection()
            if conn:
                dt = datetime.strptime(game_date, "%Y-%m-%d")
                year = dt.year
                season = f"{year}-{str(year + 1)[2:]}" if dt.month >= 10 else f"{year - 1}-{str(year)[2:]}"
                cursor = conn.cursor()
                cursor.execute(
                    f"SELECT {col} FROM team_stats WHERE team_id = %s AND season = %s",
                    (opp_team_id, season),
                )
                row = cursor.fetchone()
                cursor.close()
                conn.close()
                if row and row[0] is not None:
                    return float(row[0])
        except Exception as e:
            logger.debug(f"DB lookup failed for positional defense: {e}")

        # Context fallback
        fallback = context.get("opp_positional_def", {})
        return fallback.get(pos)

    def _get_league_avg_and_rank(
        self,
        pos: str,
        game_date: str,
        opp_team_id: str,
    ) -> tuple:
        """Compute league average for positional defense from DB."""
        col = POSITION_DEF_COLUMNS.get(pos)
        if not col:
            return None, {}

        try:
            conn = _get_db_connection()
            if conn:
                dt = datetime.strptime(game_date, "%Y-%m-%d")
                year = dt.year
                season = f"{year}-{str(year + 1)[2:]}" if dt.month >= 10 else f"{year - 1}-{str(year)[2:]}"
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    SELECT AVG({col}), COUNT(*),
                           RANK() OVER (ORDER BY {col} DESC) AS rank_val
                    FROM (
                        SELECT {col},
                               RANK() OVER (ORDER BY {col} DESC) AS rank_val
                        FROM team_stats
                        WHERE season = %s AND {col} IS NOT NULL
                    ) sub
                    WHERE team_id = %s OR TRUE
                    LIMIT 1
                    """,
                    (season, opp_team_id),
                )
                # Simpler query for avg
                cursor.execute(
                    f"SELECT AVG({col}), COUNT(*) FROM team_stats WHERE season = %s AND {col} IS NOT NULL",
                    (season,),
                )
                row = cursor.fetchone()
                cursor.close()
                conn.close()
                if row and row[0] is not None:
                    return float(row[0]), {"sample_size": int(row[1])}
        except Exception as e:
            logger.debug(f"League avg lookup failed: {e}")

        # League-wide hardcoded fallbacks (PPG allowed per position ~2022-23)
        LEAGUE_AVERAGES = {"pg": 24.5, "sg": 22.0, "sf": 20.5, "pf": 18.0, "c": 17.0}
        return LEAGUE_AVERAGES.get(pos, 20.0), {"sample_size": 0}

# Register signal with global registry
registry.register(PositionalDefenseSignal())
