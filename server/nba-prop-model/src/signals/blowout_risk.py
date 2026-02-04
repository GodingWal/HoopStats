"""
Blowout Risk Signal

Detects high blowout probability based on Vegas spread.
Large spreads (>7 points) indicate increased risk of:
- Starters sitting in garbage time
- Reduced minutes = reduced stats

Direction: Always UNDER when spread is large.
"""

from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry


class BlowoutRiskSignal(BaseSignal):
    """
    Adjust for blowout risk based on Vegas spread.

    Context required:
        - vegas_spread: float (negative = favorite, positive = underdog)
          OR spread: float
        - avg_minutes: float (player's average minutes)
        - player_is_starter: bool (starters affected more)
        - season_averages: Dict[str, float] for baseline

    Adjustment:
        - Estimate minutes lost from blowout probability
        - Reduce stats proportionally to minutes reduction
    """

    name = "blowout"
    description = "Blowout risk minutes reduction"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.60

    # Minimum spread to fire signal
    MIN_SPREAD_THRESHOLD = 7.0

    # Expected minutes lost in blowout scenarios (for starters)
    BLOWOUT_MINUTES_LOST = 8.0

    # Blowout probability by spread magnitude
    # spread >= 12: ~35% blowout
    # spread >= 8: ~20% blowout
    # spread >= 7: ~15% blowout
    BLOWOUT_PROB_THRESHOLDS = [
        (12.0, 0.35),
        (10.0, 0.28),
        (8.0, 0.20),
        (7.0, 0.15),
    ]

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate blowout risk adjustment."""

        # Get spread
        spread = context.get('vegas_spread', context.get('spread'))
        if spread is None:
            return self._create_neutral_result()

        abs_spread = abs(spread)

        # Check if spread is significant
        if abs_spread < self.MIN_SPREAD_THRESHOLD:
            return self._create_neutral_result()

        # Calculate blowout probability
        blowout_prob = self._estimate_blowout_probability(abs_spread, context)

        # Get player's average minutes
        avg_minutes = context.get('avg_minutes', 30.0)
        is_starter = context.get('player_is_starter', avg_minutes >= 25)

        # Starters lose more minutes in blowouts
        minutes_at_risk = self.BLOWOUT_MINUTES_LOST if is_starter else 4.0

        # Expected minutes lost
        expected_minutes_lost = blowout_prob * minutes_at_risk

        # Calculate stat reduction based on per-minute rates
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0 or avg_minutes <= 0:
            return self._create_neutral_result()

        # Stats per minute
        stats_per_minute = baseline / avg_minutes

        # Adjustment = expected minutes lost × stats per minute
        adjustment = -expected_minutes_lost * stats_per_minute

        return self._create_result(
            adjustment=adjustment,
            direction='UNDER',
            confidence=min(0.55 + blowout_prob * 0.3, 0.70),
            metadata={
                'vegas_spread': spread,
                'abs_spread': abs_spread,
                'blowout_probability': blowout_prob,
                'avg_minutes': avg_minutes,
                'is_starter': is_starter,
                'minutes_at_risk': minutes_at_risk,
                'expected_minutes_lost': expected_minutes_lost,
                'stats_per_minute': stats_per_minute,
                'baseline': baseline,
            },
            sample_size=30,  # Based on spread-blowout correlation data
        )

    def _estimate_blowout_probability(
        self,
        abs_spread: float,
        context: Dict[str, Any]
    ) -> float:
        """Estimate probability of blowout (>15 point margin)."""

        # Find base probability from spread
        base_prob = 0.10
        for threshold, prob in self.BLOWOUT_PROB_THRESHOLDS:
            if abs_spread >= threshold:
                base_prob = prob
                break

        # Adjust for game total if available
        total = context.get('vegas_total', context.get('total', 225.0))

        # High totals = more variance = more blowout potential
        if total > 230:
            total_mult = 1.15
        elif total > 220:
            total_mult = 1.05
        elif total < 210:
            total_mult = 0.90
        else:
            total_mult = 1.0

        return min(base_prob * total_mult, 0.50)

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        from .stat_helpers import get_baseline
        return get_baseline(stat_type, context)


# Register signal with global registry
registry.register(BlowoutRiskSignal())
