"""
Vegas Game Total Signal

The Vegas game total (Over/Under) is one of the strongest predictors
of individual player stat output. A 235-total game has ~12% more
expected scoring than a 210-total game, and that uplift flows through
to every counting stat.

Context required:
    - vegas_total: float (game O/U total from sportsbooks)
    - league_avg_total: float (optional, default 228.0 for 2024-25 season)

Signal fires when the game total deviates ≥4 points from league average.
"""

import logging
from typing import Dict, Any, Optional

from .base import BaseSignal, SignalResult, registry
from .stat_helpers import ALL_STAT_TYPES, get_baseline

logger = logging.getLogger(__name__)

# League average total for 2024-25 season
DEFAULT_LEAGUE_AVG_TOTAL = 228.0

# Minimum deviation in points from league average to fire
MIN_TOTAL_DEVIATION = 4.0

# How much each stat scales per 1% change in game total
# Points scale most directly; rebounds and assists scale less.
STAT_SENSITIVITY = {
    "Points": 1.00,
    "Rebounds": 0.50,
    "Assists": 0.75,
    "3-Pointers Made": 0.90,
    "Pts+Rebs+Asts": 0.80,
    "Steals": 0.30,
    "Blocks": 0.20,
    "Turnovers": 0.60,
    "Pts+Rebs": 0.75,
    "Pts+Asts": 0.88,
    "Rebs+Asts": 0.62,
}


class VegasTotalSignal(BaseSignal):
    """
    Adjusts projections based on the Vegas game total (O/U).

    High-total games mean more possessions, faster pace, and higher
    individual stat output across the board. Low-total games compress
    everyone's numbers.

    This is a market-derived signal — Vegas totals encode pace, defense,
    injury impact, and game-flow expectations all in one number.
    """

    name = "vegas_total"
    description = "Vegas game total (O/U) scoring environment adjustment"
    stat_types = ALL_STAT_TYPES
    default_confidence = 0.62

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any],
    ) -> SignalResult:
        vegas_total = context.get("vegas_total")
        if vegas_total is None:
            return self._create_neutral_result()

        league_avg = context.get("league_avg_total", DEFAULT_LEAGUE_AVG_TOTAL)

        deviation = vegas_total - league_avg
        if abs(deviation) < MIN_TOTAL_DEVIATION:
            return self._create_neutral_result()

        # Percentage deviation from league average
        pct_deviation = deviation / league_avg

        # Scale by stat sensitivity
        sensitivity = STAT_SENSITIVITY.get(stat_type, 0.70)
        stat_adjustment_pct = pct_deviation * sensitivity

        baseline = get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        adjustment = baseline * stat_adjustment_pct

        direction = "OVER" if deviation > 0 else "UNDER"

        # Confidence scales with the size of the deviation
        # 4-point deviation → base confidence; 15+ → high confidence
        confidence = min(0.55 + abs(deviation) * 0.015, 0.78)

        return self._create_result(
            adjustment=round(adjustment, 3),
            direction=direction,
            confidence=confidence,
            metadata={
                "vegas_total": vegas_total,
                "league_avg_total": league_avg,
                "deviation": deviation,
                "pct_deviation": round(pct_deviation, 4),
                "sensitivity": sensitivity,
                "stat_adjustment_pct": round(stat_adjustment_pct, 4),
                "baseline": baseline,
            },
            sample_size=50,
        )


registry.register(VegasTotalSignal())
