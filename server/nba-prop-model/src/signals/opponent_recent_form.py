"""
Opponent Recent Form Signal (Signal #20)

Evaluates the opposing team's recent defensive performance compared to
their season average. If the opponent has been allowing more points/stats
than usual in their last 7 games, that's a positive signal for the player.

Data source: team_game_logs table (populated by fetch_bball_ref.py scraper)

Usage:
    signal = OpponentRecentFormSignal()
    result = signal.calculate(player_id, game_date, stat_type, context)
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple

from .base import BaseSignal, SignalResult, registry

logger = logging.getLogger(__name__)

# Lazy DB connection
_db_conn = None

def _get_db():
    """Get a shared DB connection (lazy init)."""
    global _db_conn
    if _db_conn is None or _db_conn.closed:
        try:
            import sys, os
            sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
            from config.db_config import get_connection
            _db_conn = get_connection()
        except Exception as e:
            logger.warning(f"Could not connect to DB for opponent_recent_form: {e}")
            return None
    return _db_conn


class OpponentRecentFormSignal(BaseSignal):
    """
    Signal #20: Opponent Recent Defensive Form

    Looks at the opposing team's last 7 games to see if their defense
    has been better or worse than their season average.

    Logic:
        - Pull opponent's last 7 games from team_game_logs
        - Calculate rolling average of opp_pts (points allowed), def_rtg
        - Compare to full season average
        - If opponent's recent defense is WORSE (allowing more points),
          that's a positive signal for counting stats -> OVER
        - If opponent's recent defense is BETTER (allowing fewer points),
          that's a negative signal -> UNDER

    Context required:
        - opp_team_id: str (opponent team abbreviation, e.g., 'MIA')
        - game_date: str (YYYY-MM-DD)

    Signal fires when deviation > 3% from season average.
    """

    name = "opponent_recent_form"
    description = "Opponent defensive form over last 7 games vs season average"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.55

    ROLLING_WINDOW = 7      # Last N games
    MIN_GAMES = 5           # Minimum games needed in window
    MIN_SEASON_GAMES = 15   # Minimum season games for reliable baseline
    FIRE_THRESHOLD = 0.03   # 3% deviation required to fire

    # How sensitive each stat type is to opponent defense
    STAT_DEFENSE_SENSITIVITY = {
        'Points': 1.0,
        'Rebounds': 0.5,
        'Assists': 0.6,
        '3-Pointers Made': 0.7,
        'Pts+Rebs+Asts': 0.75,
        'Steals': 0.3,
        'Blocks': 0.3,
        'Turnovers': 0.4,
        'Pts+Rebs': 0.7,
        'Pts+Asts': 0.8,
        'Rebs+Asts': 0.55,
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate opponent recent form adjustment."""

        opp_team = context.get('opp_team_id')
        if not opp_team:
            return self._create_neutral_result()

        # Get opponent's defensive stats
        season_avg, rolling_avg, sample_size = self._get_opponent_defense(
            opp_team, game_date
        )

        if season_avg is None or rolling_avg is None:
            return self._create_neutral_result()

        # Calculate deviation: positive = defense is worse (allowing more)
        deviation = (rolling_avg - season_avg) / season_avg if season_avg > 0 else 0

        # Check if deviation is significant enough to fire
        if abs(deviation) < self.FIRE_THRESHOLD:
            return self._create_neutral_result()

        # Get stat sensitivity
        sensitivity = self.STAT_DEFENSE_SENSITIVITY.get(stat_type, 0.5)

        # Adjustment: opponent allowing more than usual = positive for player
        # Scale: deviation * sensitivity * base_multiplier
        base_multiplier = 3.0  # Scale factor for adjustment points
        adjustment = deviation * sensitivity * base_multiplier

        # Direction
        if deviation > 0:
            direction = "OVER"   # Opponent defense worse -> player scores more
        else:
            direction = "UNDER"  # Opponent defense better -> player scores less

        # Confidence scales with deviation magnitude and sample size
        confidence = min(0.75, self.default_confidence + abs(deviation) * 2)
        if sample_size < self.ROLLING_WINDOW:
            confidence *= 0.8  # Reduce confidence if we have fewer games

        return self._create_result(
            adjustment=round(adjustment, 3),
            direction=direction,
            confidence=round(confidence, 3),
            metadata={
                'opp_team': opp_team,
                'season_avg_pts_allowed': round(season_avg, 1),
                'rolling_avg_pts_allowed': round(rolling_avg, 1),
                'deviation_pct': round(deviation * 100, 1),
                'rolling_window': self.ROLLING_WINDOW,
                'games_in_window': sample_size,
                'stat_sensitivity': sensitivity,
            },
            sample_size=sample_size,
        )

    def _get_opponent_defense(
        self, opp_team: str, game_date: str
    ) -> Tuple[Optional[float], Optional[float], int]:
        """
        Get opponent's season average and rolling 7-game average
        of points allowed (opp_pts from the opponent's perspective).

        Returns:
            (season_avg_pts_allowed, rolling_avg_pts_allowed, rolling_sample_size)
        """
        conn = _get_db()
        if conn is None:
            return None, None, 0

        try:
            cursor = conn.cursor()

            # Season average: all games for this team before game_date
            cursor.execute("""
                SELECT AVG(opp_pts), COUNT(*)
                FROM team_game_logs
                WHERE team_abbr = %s AND game_date < %s AND opp_pts IS NOT NULL
            """, (opp_team, game_date))

            row = cursor.fetchone()
            if not row or row[1] < self.MIN_SEASON_GAMES:
                cursor.close()
                return None, None, 0

            season_avg = float(row[0])
            season_games = int(row[1])

            # Rolling average: last N games before game_date
            cursor.execute("""
                SELECT AVG(opp_pts), COUNT(*)
                FROM (
                    SELECT opp_pts
                    FROM team_game_logs
                    WHERE team_abbr = %s AND game_date < %s AND opp_pts IS NOT NULL
                    ORDER BY game_date DESC
                    LIMIT %s
                ) recent
            """, (opp_team, game_date, self.ROLLING_WINDOW))

            row = cursor.fetchone()
            cursor.close()

            if not row or row[1] < self.MIN_GAMES:
                return None, None, 0

            rolling_avg = float(row[0])
            rolling_count = int(row[1])

            return season_avg, rolling_avg, rolling_count

        except Exception as e:
            logger.warning(f"Error querying opponent defense for {opp_team}: {e}")
            try:
                conn.rollback()
            except:
                pass
            return None, None, 0


# Register with global registry
try:
    registry.register(OpponentRecentFormSignal())
except Exception:
    pass  # May fail if imported outside signal context
