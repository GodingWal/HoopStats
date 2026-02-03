"""
Recent Form Signal

Detects hot or cold streaks based on recent performance vs season average.
- HOT: Last 5 games > 110% of season average
- COLD: Last 5 games < 90% of season average

Note: This signal has mixed backtesting results.
Hot/cold streaks may be more noise than signal in many cases.
"""

from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry


class RecentFormSignal(BaseSignal):
    """
    Detect hot/cold streaks from recent game performance.

    Context required:
        - season_averages: Dict[str, float] with pts, reb, ast, etc.
        - last_5_averages: Dict[str, float] recent 5 games
        - last_10_averages: Dict[str, float] recent 10 games (optional)

    Form calculation:
        - Uses weighted average: 0.5*L5 + 0.3*L10 + 0.2*season
        - HOT: L5 > 110% of season → OVER
        - COLD: L5 < 90% of season → UNDER
    """

    name = "recent_form"
    description = "Recent performance hot/cold detection"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.50  # Lower confidence - streaks are noisy

    # Thresholds for detecting form
    HOT_THRESHOLD = 1.10   # 110% of season average
    COLD_THRESHOLD = 0.90  # 90% of season average

    # Weights for blended projection
    L5_WEIGHT = 0.50
    L10_WEIGHT = 0.30
    SEASON_WEIGHT = 0.20

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate form-based adjustment."""

        # Get averages - ensure they're dicts, not None
        season_avgs = context.get('season_averages') or {}
        l5_avgs = context.get('last_5_averages') or {}
        l10_avgs = context.get('last_10_averages') or season_avgs  # Fallback to season

        stat_key = self._get_stat_key(stat_type)
        if stat_key is None:
            return self._create_neutral_result()

        # Get values
        season_val = self._get_stat_value(season_avgs, stat_key, stat_type)
        l5_val = self._get_stat_value(l5_avgs, stat_key, stat_type)
        l10_val = self._get_stat_value(l10_avgs, stat_key, stat_type)

        if season_val is None or l5_val is None or season_val <= 0:
            return self._create_neutral_result()

        # Use season if L10 not available
        if l10_val is None:
            l10_val = season_val

        # Calculate form ratio (L5 vs season)
        form_ratio = l5_val / season_val

        # Check if form is significant
        is_hot = form_ratio >= self.HOT_THRESHOLD
        is_cold = form_ratio <= self.COLD_THRESHOLD

        if not is_hot and not is_cold:
            return self._create_neutral_result()

        # Calculate weighted average
        weighted_avg = (
            self.L5_WEIGHT * l5_val +
            self.L10_WEIGHT * l10_val +
            self.SEASON_WEIGHT * season_val
        )

        # Adjustment is weighted avg minus season baseline
        adjustment = weighted_avg - season_val

        # Determine direction and form type
        if is_hot:
            direction = 'OVER'
            form_type = 'HOT'
        else:
            direction = 'UNDER'
            form_type = 'COLD'

        # Scale confidence by form magnitude (but keep it low overall)
        deviation = abs(form_ratio - 1.0)
        confidence = min(0.45 + deviation * 0.5, 0.60)

        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'form_type': form_type,
                'form_ratio': form_ratio,
                'season_avg': season_val,
                'l5_avg': l5_val,
                'l10_avg': l10_val,
                'weighted_avg': weighted_avg,
            },
            sample_size=5,  # Based on L5 primarily
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
registry.register(RecentFormSignal())
