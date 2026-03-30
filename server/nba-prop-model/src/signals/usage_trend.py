"""
Usage Trend Signal

Tracks structural changes in a player's role — rising or declining
usage rate, field goal attempts, and minutes share — independent of
whether they've been scoring more or less (that's output noise).

A player whose FGA and usage are trending UP is getting more opportunity,
which is predictive of future output. A player whose usage is dropping
is losing role share, often before the box score catches up.

Context required:
    - usage_rate_l5: float (usage rate over last 5 games)
    - usage_rate_season: float (season-long usage rate)
    - fga_l5: float (FGA per game, last 5)
    - fga_season: float (FGA per game, season)
    - minutes_l5: float (minutes per game, last 5, optional)
    - minutes_season: float (minutes per game, season, optional)
"""

import logging
from typing import Dict, Any, Optional

from .base import BaseSignal, SignalResult, registry
from .stat_helpers import ALL_STAT_TYPES, get_baseline

logger = logging.getLogger(__name__)

# Minimum percentage change in usage/FGA to be considered meaningful
MIN_USAGE_CHANGE_PCT = 0.08  # 8% relative change
MIN_FGA_CHANGE_PCT = 0.10    # 10% relative change

# Stat sensitivity to usage changes
# Points/3PM are most directly tied to shot volume; assists less so
STAT_SENSITIVITY = {
    "Points": 1.00,
    "3-Pointers Made": 0.90,
    "Turnovers": 0.70,
    "Pts+Asts": 0.85,
    "Pts+Rebs": 0.75,
    "Pts+Rebs+Asts": 0.75,
    "Assists": 0.50,
    "Rebounds": 0.30,
    "Steals": 0.25,
    "Blocks": 0.15,
    "Pts+Asts": 0.85,
    "Rebs+Asts": 0.40,
}


class UsageTrendSignal(BaseSignal):
    """
    Detects structural shifts in player opportunity.

    Unlike recent_form (which chases output streaks that revert),
    this signal tracks *opportunity* metrics: usage rate and shot
    attempts. A player getting more shots is a leading indicator;
    a player scoring more on the same shots is noise.

    Components:
    1. Usage rate trend (L5 vs season)
    2. FGA trend (L5 vs season)
    3. Optional minutes trend confirmation

    All three must trend in the same direction for full confidence.
    """

    name = "usage_trend"
    description = "Player usage rate and shot volume trend"
    stat_types = ALL_STAT_TYPES
    default_confidence = 0.58

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any],
    ) -> SignalResult:
        usage_l5 = context.get("usage_rate_l5")
        usage_season = context.get("usage_rate_season")
        fga_l5 = context.get("fga_l5")
        fga_season = context.get("fga_season")

        # Need at least one pair to compute a trend
        has_usage = usage_l5 is not None and usage_season is not None and usage_season > 0
        has_fga = fga_l5 is not None and fga_season is not None and fga_season > 0

        if not has_usage and not has_fga:
            return self._create_neutral_result()

        # Calculate relative changes
        usage_change = (usage_l5 / usage_season - 1.0) if has_usage else 0.0
        fga_change = (fga_l5 / fga_season - 1.0) if has_fga else 0.0

        # Optional minutes confirmation
        min_l5 = context.get("minutes_l5")
        min_season = context.get("minutes_season")
        has_minutes = min_l5 is not None and min_season is not None and min_season > 0
        minutes_change = (min_l5 / min_season - 1.0) if has_minutes else 0.0

        # Composite trend score — average of available metrics
        components = []
        if has_usage and abs(usage_change) >= MIN_USAGE_CHANGE_PCT:
            components.append(usage_change)
        if has_fga and abs(fga_change) >= MIN_FGA_CHANGE_PCT:
            components.append(fga_change)

        if not components:
            return self._create_neutral_result()

        trend_score = sum(components) / len(components)

        # Minutes confirmation boosts confidence but doesn't change direction
        minutes_confirms = has_minutes and (
            (trend_score > 0 and minutes_change > 0.03) or
            (trend_score < 0 and minutes_change < -0.03)
        )

        baseline = get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        sensitivity = STAT_SENSITIVITY.get(stat_type, 0.50)
        adjustment = baseline * trend_score * sensitivity

        # Cap adjustment at ±12% of baseline
        max_adj = baseline * 0.12
        adjustment = max(-max_adj, min(max_adj, adjustment))

        direction = "OVER" if trend_score > 0 else "UNDER"

        # Confidence: base + magnitude + minutes confirmation
        confidence = 0.52 + min(abs(trend_score) * 1.5, 0.15)
        if minutes_confirms:
            confidence += 0.06
        if len(components) == 2:
            confidence += 0.04  # Both usage and FGA agree
        confidence = min(confidence, 0.75)

        return self._create_result(
            adjustment=round(adjustment, 3),
            direction=direction,
            confidence=confidence,
            metadata={
                "usage_change_pct": round(usage_change, 4) if has_usage else None,
                "fga_change_pct": round(fga_change, 4) if has_fga else None,
                "minutes_change_pct": round(minutes_change, 4) if has_minutes else None,
                "trend_score": round(trend_score, 4),
                "minutes_confirms": minutes_confirms,
                "components_used": len(components),
                "sensitivity": sensitivity,
                "baseline": baseline,
            },
            sample_size=5,
        )


registry.register(UsageTrendSignal())
