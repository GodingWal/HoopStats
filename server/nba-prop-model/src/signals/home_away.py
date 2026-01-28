"""
Home/Away Signal

Detects meaningful splits between home and away performance.
Players often perform better at home due to:
- Crowd support
- Familiar environment
- No travel fatigue
- Sleep in own bed

Only fires when split difference is significant (>5%).
"""

from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry


class HomeAwaySignal(BaseSignal):
    """
    Detect meaningful home/away splits and adjust accordingly.

    Context required:
        - is_home: bool (True if home game)
        - home_averages: Dict[str, float] with pts, reb, ast, etc.
        - away_averages: Dict[str, float] with pts, reb, ast, etc.
        - season_averages: Dict[str, float] for baseline

    Only fires when split difference >= 5% of season average.
    """

    name = "home_away"
    description = "Home/away performance split"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.55  # Moderate confidence, splits can be noisy

    # Minimum split percentage to fire signal
    MIN_SPLIT_THRESHOLD = 0.05  # 5%

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate home/away split adjustment."""

        is_home = context.get('is_home')
        if is_home is None:
            return self._create_neutral_result()

        # Get averages
        home_avgs = context.get('home_averages', {})
        away_avgs = context.get('away_averages', {})
        season_avgs = context.get('season_averages', {})

        # Get stat values
        stat_key = self._get_stat_key(stat_type)
        if stat_key is None:
            return self._create_neutral_result()

        home_val = self._get_stat_value(home_avgs, stat_key, stat_type)
        away_val = self._get_stat_value(away_avgs, stat_key, stat_type)
        season_val = self._get_stat_value(season_avgs, stat_key, stat_type)

        if home_val is None or away_val is None or season_val is None or season_val <= 0:
            return self._create_neutral_result()

        # Calculate split difference
        split_diff = home_val - away_val
        split_pct = abs(split_diff) / season_val

        # Check if split is significant
        if split_pct < self.MIN_SPLIT_THRESHOLD:
            return self._create_neutral_result()

        # Determine relevant average and direction
        if is_home:
            relevant_avg = home_val
            direction = 'OVER' if home_val > season_val else 'UNDER'
        else:
            relevant_avg = away_val
            direction = 'OVER' if away_val > season_val else 'UNDER'

        # Adjustment is difference between relevant split and season average
        adjustment = relevant_avg - season_val

        # Scale confidence by split magnitude
        confidence = min(0.45 + split_pct, 0.70)

        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'is_home': is_home,
                'home_avg': home_val,
                'away_avg': away_val,
                'season_avg': season_val,
                'split_diff': split_diff,
                'split_pct': split_pct,
            },
            sample_size=20,  # Typical sample size for split data
        )

    def _get_stat_key(self, stat_type: str) -> Optional[str]:
        """Map stat type to key in averages dict."""
        stat_key_map = {
            'Points': 'pts',
            'Rebounds': 'reb',
            'Assists': 'ast',
            '3-Pointers Made': 'fg3m',
            'Pts+Rebs+Asts': 'pra',
        }
        return stat_key_map.get(stat_type)

    def _get_stat_value(
        self,
        averages: Dict[str, float],
        stat_key: str,
        stat_type: str
    ) -> Optional[float]:
        """Get stat value from averages dict."""

        if stat_key in averages:
            return averages[stat_key]

        # Handle PRA
        if stat_type == 'Pts+Rebs+Asts':
            pts = averages.get('pts', 0)
            reb = averages.get('reb', 0)
            ast = averages.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast

        return None


# Register signal with global registry
registry.register(HomeAwaySignal())
