"""
Pace Matchup Signal

Detects when opponent pace differs significantly from league average.
Fast-paced teams create more possessions → more stats.
Slow-paced teams limit possessions → fewer stats.

Only fires when pace difference >= 3% from league average.
"""

from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry


class PaceMatchupSignal(BaseSignal):
    """
    Adjust projections based on opponent pace.

    Context required:
        - opponent_pace: float (possessions per 48 minutes) OR
        - opponent_pace_rank: int (1-30, 1=fastest)
        - season_averages: Dict[str, float] for baseline

    Adjustment:
        - baseline × pace_effect × stat_sensitivity
        - Points most sensitive (1.0), rebounds less so (0.6)
    """

    name = "pace"
    description = "Opponent pace matchup adjustment"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.55

    # League average pace (2024-25 season approximation)
    LEAGUE_AVG_PACE = 100.0

    # Minimum pace difference to fire signal (as percentage)
    MIN_PACE_THRESHOLD = 0.03  # 3%

    # Stat sensitivity to pace (1.0 = fully sensitive)
    STAT_SENSITIVITY = {
        'Points': 1.0,
        'Rebounds': 0.6,          # Less possessions = fewer rebounding opportunities
        'Assists': 0.9,           # Highly correlated with possessions
        '3-Pointers Made': 0.9,
        'Pts+Rebs+Asts': 0.85,
        'Steals': 0.7,            # More possessions = more steal opportunities
        'Blocks': 0.5,            # Blocks less pace-dependent
        'Turnovers': 0.8,         # More possessions = more turnover opportunities
        'Pts+Rebs': 0.8,
        'Pts+Asts': 0.95,
        'Rebs+Asts': 0.75,
    }

    # Pace by rank (approximation for 1-30 scale)
    # Rank 1 ≈ 105 pace, Rank 30 ≈ 95 pace
    PACE_RANGE = (95.0, 105.0)

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate pace-based adjustment."""

        # Get opponent pace
        opp_pace = self._get_opponent_pace(context)
        if opp_pace is None:
            return self._create_neutral_result()

        # Calculate pace factor relative to league average
        pace_factor = opp_pace / self.LEAGUE_AVG_PACE
        pace_diff = pace_factor - 1.0

        # Check if pace difference is significant
        if abs(pace_diff) < self.MIN_PACE_THRESHOLD:
            return self._create_neutral_result()

        # Get baseline for this stat
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Get stat sensitivity
        sensitivity = self.STAT_SENSITIVITY.get(stat_type, 0.8)

        # Calculate adjustment
        adjustment = baseline * pace_diff * sensitivity

        # Determine direction
        if pace_diff > 0:
            direction = 'OVER'
            pace_type = 'FAST'
        else:
            direction = 'UNDER'
            pace_type = 'SLOW'

        # Scale confidence by pace magnitude
        confidence = min(0.50 + abs(pace_diff) * 2, 0.65)

        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'opponent_pace': opp_pace,
                'league_avg_pace': self.LEAGUE_AVG_PACE,
                'pace_factor': pace_factor,
                'pace_diff': pace_diff,
                'pace_type': pace_type,
                'stat_sensitivity': sensitivity,
                'baseline': baseline,
            },
            sample_size=30,  # Based on opponent's games
        )

    def _get_opponent_pace(self, context: Dict[str, Any]) -> Optional[float]:
        """Get opponent pace from context."""

        # Direct pace value
        if 'opponent_pace' in context:
            return context['opponent_pace']

        # Calculate from rank (1 = fastest = highest pace)
        if 'opponent_pace_rank' in context:
            rank = context['opponent_pace_rank']
            if 1 <= rank <= 30:
                # Linear interpolation: rank 1 → 105, rank 30 → 95
                pace_range = self.PACE_RANGE[1] - self.PACE_RANGE[0]
                return self.PACE_RANGE[1] - (rank - 1) / 29 * pace_range

        # Try opponent_stats dict
        opp_stats = context.get('opponent_stats') or {}
        if 'pace' in opp_stats:
            return opp_stats['pace']

        return None

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        from .stat_helpers import get_baseline
        return get_baseline(stat_type, context)


# Register signal with global registry
registry.register(PaceMatchupSignal())
