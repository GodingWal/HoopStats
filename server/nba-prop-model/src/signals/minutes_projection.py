"""
Minutes Projection Signal

Minutes played is the #1 predictor of prop outcomes.
This signal analyzes recent minutes trends and adjusts projections based on
expected minutes vs season average minutes.

Factors:
- Recent 5-10 game minutes trend
- Team pace and game context (blowout potential)
- B2B and fatigue effects on minutes
- Starter vs bench role stability
"""

import logging
from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry

logger = logging.getLogger(__name__)


class MinutesProjectionSignal(BaseSignal):
    name = "minutes_projection"
    description = "Minutes-based projection adjustment - #1 predictor of prop outcomes"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made",
        "Pts+Rebs+Asts", "Steals", "Blocks", "Turnovers",
        "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.65

    # Minutes deviation thresholds
    MIN_DEVIATION_PCT = 3.0   # Need at least 3% minutes deviation to fire
    MAX_ADJUSTMENT_PCT = 15.0  # Cap adjustment at 15% of baseline

    def calculate(self, player_id: str, game_date: str, stat_type: str,
                  context: Dict[str, Any]) -> SignalResult:
        """
        Calculate minutes-based projection adjustment.

        Looks at:
        1. Recent minutes trend vs season average
        2. Blowout potential (reduces starters' minutes)
        3. B2B fatigue (typically -2 to -4 min)
        4. Pace factor (faster pace = slightly more minutes for starters)
        """
        season_avgs = context.get("season_averages") or {}
        last5 = context.get("last_5_averages") or {}
        last10 = context.get("last_10_averages") or {}

        # Get season average minutes
        season_min = self._get_minutes(season_avgs)
        if season_min is None or season_min < 10:
            return self._create_neutral_result()

        # Get recent minutes (prefer last 5, fall back to last 10)
        recent_min = self._get_minutes(last5) or self._get_minutes(last10)
        if recent_min is None:
            return self._create_neutral_result()

        # Calculate base minutes deviation
        min_deviation_pct = ((recent_min - season_min) / season_min) * 100

        # Adjustment factors
        adjustments = 0.0
        metadata = {
            "season_min": round(season_min, 1),
            "recent_min": round(recent_min, 1),
            "base_deviation_pct": round(min_deviation_pct, 2),
        }

        # Factor 1: B2B fatigue typically costs 2-4 minutes
        is_b2b = context.get("is_b2b", False) or context.get("rest_days", 99) == 0
        if is_b2b:
            b2b_min_loss = -3.0  # average minutes lost on B2B
            adjustments += (b2b_min_loss / season_min) * 100
            metadata["b2b_min_adjustment"] = b2b_min_loss

        # Factor 2: Blowout potential (large spread reduces starters' minutes)
        spread = context.get("spread")
        projected_total = context.get("projected_total")
        if spread is not None:
            try:
                spread_val = abs(float(spread))
                if spread_val > 10:
                    # Big favorites/underdogs see ~3-5 min reduction for starters
                    blowout_factor = min((spread_val - 10) * 0.5, 5.0)
                    adjustments -= (blowout_factor / season_min) * 100
                    metadata["blowout_min_adjustment"] = -round(blowout_factor, 1)
            except (ValueError, TypeError):
                pass

        # Factor 3: Recent minutes trend is the primary signal
        total_deviation = min_deviation_pct + adjustments

        # Check threshold
        if abs(total_deviation) < self.MIN_DEVIATION_PCT:
            return self._create_neutral_result()

        # Cap the adjustment
        total_deviation = max(-self.MAX_ADJUSTMENT_PCT,
                            min(self.MAX_ADJUSTMENT_PCT, total_deviation))

        # Convert minutes deviation to stat projection adjustment
        # Minutes and stats are roughly proportional
        # (e.g., 10% more minutes -> ~8-10% more stats)
        stat_adjustment_pct = total_deviation * 0.85  # slight dampening

        # Get baseline to compute absolute adjustment
        from .stat_helpers import get_baseline
        baseline = get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        adjustment = baseline * (stat_adjustment_pct / 100)
        direction = "OVER" if adjustment > 0 else "UNDER"

        # Confidence based on magnitude of deviation and sample
        confidence = min(0.55 + abs(total_deviation) / 100, 0.80)

        metadata["total_deviation_pct"] = round(total_deviation, 2)
        metadata["stat_adjustment_pct"] = round(stat_adjustment_pct, 2)
        metadata["baseline"] = round(baseline, 2)

        return SignalResult(
            adjustment=round(adjustment, 2),
            direction=direction,
            confidence=confidence,
            signal_name=self.name,
            fired=True,
            metadata=metadata,
            sample_size=5,  # based on last 5 games
        )

    def _get_minutes(self, averages: Dict[str, Any]) -> Optional[float]:
        """Extract minutes from an averages dict."""
        for key in ["min", "MIN", "minutes", "MINUTES", "mp", "MP"]:
            if key in averages:
                try:
                    val = averages[key]
                    if isinstance(val, str) and ":" in val:
                        # Handle "MM:SS" format
                        parts = val.split(":")
                        return float(parts[0]) + float(parts[1]) / 60
                    return float(val)
                except (ValueError, TypeError):
                    continue
        return None

    def _create_neutral_result(self) -> SignalResult:
        return SignalResult(
            adjustment=0.0,
            direction=None,
            confidence=0.0,
            signal_name=self.name,
            fired=False,
            metadata={"reason": "insufficient minutes data or below threshold"},
        )


# Auto-register
registry.register(MinutesProjectionSignal())
