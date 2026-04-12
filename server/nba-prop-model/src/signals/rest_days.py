"""
Rest Days Signal

Calculates rest days between games for the player's team and opponent.
Adjustment logic:
  - 0 rest days (B2B):     -5% projection adjustment
  - 1 rest day:             0% (neutral)
  - 2+ rest days:          +3% adjustment
  - Opponent on B2B:       +4% boost (they're tired, you score more)
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from .base import BaseSignal, SignalResult, registry

logger = logging.getLogger(__name__)

ALL_STAT_TYPES = [
    "Points", "Rebounds", "Assists", "3-Pointers Made",
    "Steals", "Blocks", "Turnovers",
    "Pts+Rebs", "Pts+Asts", "Pts+Rebs+Asts", "Blks+Stls",
]


def _rest_days_from_context(game_date: str, last_game_date: Optional[str]) -> Optional[int]:
    """Calculate rest days given a game date and previous game date string.

    Returns None when last_game_date is missing — callers must treat None as
    'no data available' and NOT fire the signal with a default value.
    """
    if not last_game_date:
        return None  # No prior game info — do not guess
    try:
        gd = datetime.strptime(game_date, "%Y-%m-%d").date()
        lgd = datetime.strptime(last_game_date, "%Y-%m-%d").date()
        return max(0, (gd - lgd).days - 1)
    except Exception:
        return None


def calculate_rest_adjustment(
    rest_days: int,
    opp_rest_days: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Compute percentage adjustments based on rest days.

    Args:
        rest_days: Rest days for the player's team (0 = B2B, 1+ = rested)
        opp_rest_days: Rest days for opponent team

    Returns:
        dict with keys: player_adj_pct, opp_adj_pct, total_adj_pct, direction, notes
    """
    # Player team fatigue
    if rest_days == 0:
        player_adj = -0.05   # B2B penalty
        player_note = "B2B fatigue (-5%)"
    elif rest_days == 1:
        player_adj = 0.00    # Neutral
        player_note = "1 rest day (neutral)"
    else:
        player_adj = 0.03    # Well-rested boost
        player_note = f"{rest_days} rest days (+3%)"

    # Opponent fatigue bonus
    opp_adj = 0.0
    opp_note = ""
    if opp_rest_days is not None and opp_rest_days == 0:
        opp_adj = 0.04       # Opponent on B2B → player scores more
        opp_note = "Opponent B2B (+4%)"

    total_adj = player_adj + opp_adj

    if total_adj > 0:
        direction = "OVER"
    elif total_adj < 0:
        direction = "UNDER"
    else:
        direction = None

    return {
        "player_adj_pct": player_adj,
        "opp_adj_pct": opp_adj,
        "total_adj_pct": total_adj,
        "direction": direction,
        "notes": " | ".join(filter(None, [player_note, opp_note])),
        "rest_days": rest_days,
        "opp_rest_days": opp_rest_days,
    }


class RestDaysSignal(BaseSignal):
    """
    Signal: rest-day adjustments for player and opponent.

    Context keys used:
        - game_date (str): Current game date YYYY-MM-DD
        - last_game_date (str, optional): Date of last game for player's team
        - opp_last_game_date (str, optional): Date of last game for opponent
        - rest_days (int, optional): Pre-calculated rest days for player's team
        - opp_rest_days (int, optional): Pre-calculated rest days for opponent
    """

    name = "rest_days"
    description = "Rest-day fatigue and opponent B2B advantage"
    stat_types = ALL_STAT_TYPES
    default_confidence = 0.55

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any],
    ) -> SignalResult:
        # Prefer pre-calculated rest days; fall back to date arithmetic.
        # If NEITHER source provides real data, do NOT fire with a default value —
        # that would inject a fabricated +3% OVER signal on every bet with no game data.
        rest = context.get("rest_days")
        if rest is None:
            rest = _rest_days_from_context(
                game_date, context.get("last_game_date")
            )

        if rest is None:
            logger.debug(
                "rest_days signal: no rest data (rest_days and last_game_date both missing) "
                "— returning neutral to avoid default fabrication"
            )
            return self._create_neutral_result()

        opp_rest = context.get("opp_rest_days")
        if opp_rest is None and context.get("opp_last_game_date"):
            opp_rest = _rest_days_from_context(
                game_date, context.get("opp_last_game_date")
            )

        result = calculate_rest_adjustment(rest, opp_rest)

        if result["direction"] is None:
            return self._create_neutral_result()

        # Confidence is higher when both signals align in same direction
        base_conf = 0.50
        if result["player_adj_pct"] != 0 and result["opp_adj_pct"] != 0:
            # Both firing in same direction
            confidence = min(0.75, base_conf + 0.15)
        else:
            confidence = min(0.65, base_conf + 0.10)

        return self._create_result(
            adjustment=round(result["total_adj_pct"], 4),
            direction=result["direction"],
            confidence=confidence,
            metadata={
                "rest_days": rest,
                "opp_rest_days": opp_rest,
                "player_adj_pct": result["player_adj_pct"],
                "opp_adj_pct": result["opp_adj_pct"],
                "notes": result["notes"],
            },
            sample_size=0,
        )

# Register signal with global registry
registry.register(RestDaysSignal())
