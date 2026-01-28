"""
Back-to-Back Signal

Detects when a player is playing on consecutive nights (back-to-back).
Historical data shows B2B games result in:
- ~3% efficiency drop
- ~4.5 minutes reduction
- Combined ~8% stat reduction

Direction: Always UNDER
"""

from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional
from .base import BaseSignal, SignalResult, registry


class BackToBackSignal(BaseSignal):
    """
    Detect back-to-back games and apply appropriate penalty.

    Context required:
        - is_b2b: bool (direct flag) OR
        - team_schedule: List[str] of game dates to calculate B2B

    Adjustment calculation:
        - Points: -8% of baseline (efficiency + minutes combined)
        - Rebounds: -6% of baseline
        - Assists: -6% of baseline
        - Threes: -10% of baseline (shooting suffers most)
    """

    name = "b2b"
    description = "Back-to-back game fatigue penalty"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.65  # B2B is a strong, well-documented signal

    # Percentage adjustments by stat type (negative = reduction)
    STAT_ADJUSTMENTS = {
        "Points": -0.08,           # 8% reduction
        "Rebounds": -0.06,         # 6% reduction
        "Assists": -0.06,          # 6% reduction
        "3-Pointers Made": -0.10,  # 10% reduction (shooting suffers)
        "Pts+Rebs+Asts": -0.07,    # 7% reduction (weighted average)
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate B2B adjustment."""

        # Determine if this is a B2B game
        is_b2b = self._check_b2b(game_date, context)

        if not is_b2b:
            return self._create_neutral_result()

        # Get baseline value for this stat
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Calculate adjustment
        adjustment_pct = self.STAT_ADJUSTMENTS.get(stat_type, -0.07)
        adjustment = baseline * adjustment_pct

        return self._create_result(
            adjustment=adjustment,
            direction='UNDER',
            confidence=self.default_confidence,
            metadata={
                'is_b2b': True,
                'baseline': baseline,
                'adjustment_pct': adjustment_pct,
            },
            sample_size=100,  # B2B is well-studied
        )

    def _check_b2b(self, game_date: str, context: Dict[str, Any]) -> bool:
        """Check if the game is a back-to-back."""

        # Direct flag takes precedence
        if 'is_b2b' in context:
            return bool(context['is_b2b'])

        # Calculate from schedule
        team_schedule = context.get('team_schedule', [])
        if not team_schedule:
            return False

        try:
            current_date = datetime.strptime(game_date, '%Y-%m-%d')
            yesterday = (current_date - timedelta(days=1)).strftime('%Y-%m-%d')

            # Check if team played yesterday
            return yesterday in team_schedule
        except (ValueError, TypeError):
            return False

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""

        season_avgs = context.get('season_averages', {})

        # Map stat types to keys in season_averages
        stat_key_map = {
            'Points': 'pts',
            'Rebounds': 'reb',
            'Assists': 'ast',
            '3-Pointers Made': 'fg3m',
            'Pts+Rebs+Asts': 'pra',
        }

        key = stat_key_map.get(stat_type)
        if key and key in season_avgs:
            return season_avgs[key]

        # Handle PRA if not directly available
        if stat_type == 'Pts+Rebs+Asts':
            pts = season_avgs.get('pts', 0)
            reb = season_avgs.get('reb', 0)
            ast = season_avgs.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast

        return None


# Register signal with global registry
registry.register(BackToBackSignal())
