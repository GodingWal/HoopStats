"""
Closing Line Value (CLV) Tracker Signal

Tracks whether our picks historically beat the closing line.
Picks that consistently capture CLV indicate a real edge.

This signal acts as a meta-filter:
- If a player/stat combo has historically captured positive CLV, boost confidence
- If a player/stat combo has historically been on the wrong side of CLV, reduce confidence
- Uses a rolling window of recent picks to calculate CLV capture rate

Context required:
    - opening_line: float (the line when we first recommended)
    - closing_line: float (the line at game time)
    - historical_clv: List[Dict] with past CLV records for this player/stat
    - line_movement_direction: str ('toward_our_pick' or 'away_from_our_pick')
"""

from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry


class CLVTrackerSignal(BaseSignal):
    """
    Track and filter based on Closing Line Value.

    CLV = difference between our pick line and closing line.
    Positive CLV means the market moved in our direction (sharp money agrees).

    Signal logic:
        - Strong positive CLV history → boost confidence (OVER/UNDER depending on pick)
        - Negative CLV history → reduce confidence / don't fire
        - Line moved toward our pick → confirmation signal
        - Line moved away → caution signal
    """

    name = "clv_tracker"
    description = "Closing line value tracking and filtering"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.60

    # Minimum CLV records needed to fire
    MIN_CLV_HISTORY = 5

    # CLV thresholds
    POSITIVE_CLV_THRESHOLD = 0.5    # Line moved 0.5+ points in our favor
    STRONG_CLV_THRESHOLD = 1.0      # Line moved 1.0+ points in our favor
    NEGATIVE_CLV_THRESHOLD = -0.5   # Line moved against us

    # CLV capture rate thresholds
    HIGH_CLV_RATE = 0.60    # 60%+ of picks capture positive CLV
    LOW_CLV_RATE = 0.40     # Below 40% = consistently wrong side

    # Line movement thresholds for live signal
    SIGNIFICANT_MOVE = 0.5   # 0.5 point move is meaningful
    STEAM_MOVE = 1.5         # 1.5+ point move is a steam move

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate CLV-based adjustment."""

        # Check for live line movement signal
        live_result = self._check_live_line_movement(context)
        if live_result is not None:
            return live_result

        # Check historical CLV performance
        historical_clv = context.get('historical_clv', [])
        if len(historical_clv) < self.MIN_CLV_HISTORY:
            return self._create_neutral_result()

        # Calculate CLV metrics
        clv_values = [record.get('clv', 0) for record in historical_clv]
        positive_clv_count = sum(1 for v in clv_values if v > self.POSITIVE_CLV_THRESHOLD)
        negative_clv_count = sum(1 for v in clv_values if v < self.NEGATIVE_CLV_THRESHOLD)
        total = len(clv_values)

        clv_capture_rate = positive_clv_count / total if total > 0 else 0.5
        avg_clv = sum(clv_values) / total if total > 0 else 0.0

        # Determine if we should boost or suppress
        if clv_capture_rate >= self.HIGH_CLV_RATE and avg_clv > 0:
            # Strong CLV history - this player/stat is a good target
            direction = context.get('model_direction', 'OVER')
            baseline = self._get_baseline(stat_type, context)
            if baseline is None or baseline <= 0:
                return self._create_neutral_result()

            # Scale adjustment by CLV magnitude
            adjustment = baseline * min(avg_clv / 10.0, 0.05)  # Max 5% boost
            if direction == 'UNDER':
                adjustment = -adjustment

            confidence = min(0.55 + clv_capture_rate * 0.2, 0.75)

            return self._create_result(
                adjustment=adjustment,
                direction=direction,
                confidence=confidence,
                metadata={
                    'clv_capture_rate': clv_capture_rate,
                    'avg_clv': avg_clv,
                    'positive_clv_count': positive_clv_count,
                    'negative_clv_count': negative_clv_count,
                    'total_clv_records': total,
                    'signal_type': 'historical_clv_positive',
                },
                sample_size=total,
            )

        elif clv_capture_rate <= self.LOW_CLV_RATE and avg_clv < 0:
            # Bad CLV history - suppress this pick
            direction = context.get('model_direction', 'OVER')
            # Flip direction as a warning
            suppress_direction = 'UNDER' if direction == 'OVER' else 'OVER'

            baseline = self._get_baseline(stat_type, context)
            if baseline is None or baseline <= 0:
                return self._create_neutral_result()

            # Negative adjustment to counteract the model's pick
            adjustment = baseline * max(avg_clv / 10.0, -0.03)  # Max 3% suppression
            if suppress_direction == 'OVER':
                adjustment = abs(adjustment)
            else:
                adjustment = -abs(adjustment)

            return self._create_result(
                adjustment=adjustment,
                direction=suppress_direction,
                confidence=0.45,
                metadata={
                    'clv_capture_rate': clv_capture_rate,
                    'avg_clv': avg_clv,
                    'positive_clv_count': positive_clv_count,
                    'negative_clv_count': negative_clv_count,
                    'total_clv_records': total,
                    'signal_type': 'historical_clv_negative',
                },
                sample_size=total,
            )

        return self._create_neutral_result()

    def _check_live_line_movement(self, context: Dict[str, Any]) -> Optional[SignalResult]:
        """
        Check live line movement as a real-time CLV proxy.

        If the line has moved significantly since open, that's information:
        - Steam move (1.5+ pts) in our direction → strong confirmation
        - Reverse line movement (public on one side, line moves other) → sharp signal
        """
        opening_line = context.get('opening_line')
        current_line = context.get('current_line') or context.get('closing_line')

        if opening_line is None or current_line is None:
            return None

        line_move = current_line - opening_line
        abs_move = abs(line_move)

        if abs_move < self.SIGNIFICANT_MOVE:
            return None

        model_direction = context.get('model_direction')
        if model_direction is None:
            return None

        baseline = self._get_baseline(
            context.get('stat_type', 'Points'), context
        )
        if baseline is None or baseline <= 0:
            return None

        # Determine if movement confirms or contradicts our pick
        # If line went UP: market expects more (OVER is harder to hit)
        # If line went DOWN: market expects less (UNDER is harder to hit)
        if model_direction == 'OVER':
            # Line going UP = market moved against over = our pick is contrarian
            # Line going DOWN = market moved with us = confirmation
            move_confirms = line_move < 0
        else:
            move_confirms = line_move > 0

        if abs_move >= self.STEAM_MOVE:
            # Steam move
            if move_confirms:
                # Strong confirmation - sharp money agrees
                adjustment = baseline * 0.03
                if model_direction == 'UNDER':
                    adjustment = -adjustment
                return self._create_result(
                    adjustment=adjustment,
                    direction=model_direction,
                    confidence=0.70,
                    metadata={
                        'line_move': line_move,
                        'opening_line': opening_line,
                        'current_line': current_line,
                        'move_type': 'steam_confirms',
                        'signal_type': 'live_line_movement',
                    },
                    sample_size=1,
                )
            else:
                # Steam move against us - strong caution
                counter_direction = 'UNDER' if model_direction == 'OVER' else 'OVER'
                adjustment = baseline * 0.02
                if counter_direction == 'UNDER':
                    adjustment = -adjustment
                return self._create_result(
                    adjustment=adjustment,
                    direction=counter_direction,
                    confidence=0.55,
                    metadata={
                        'line_move': line_move,
                        'opening_line': opening_line,
                        'current_line': current_line,
                        'move_type': 'steam_contradicts',
                        'signal_type': 'live_line_movement',
                    },
                    sample_size=1,
                )

        elif abs_move >= self.SIGNIFICANT_MOVE:
            if move_confirms:
                adjustment = baseline * 0.015
                if model_direction == 'UNDER':
                    adjustment = -adjustment
                return self._create_result(
                    adjustment=adjustment,
                    direction=model_direction,
                    confidence=0.58,
                    metadata={
                        'line_move': line_move,
                        'opening_line': opening_line,
                        'current_line': current_line,
                        'move_type': 'confirms',
                        'signal_type': 'live_line_movement',
                    },
                    sample_size=1,
                )

        return None

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        season_avgs = context.get('season_averages', {})
        stat_key_map = {
            'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
            '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra',
        }
        key = stat_key_map.get(stat_type)
        if key and key in season_avgs:
            return season_avgs[key]
        if stat_type == 'Pts+Rebs+Asts':
            pts = season_avgs.get('pts', 0)
            reb = season_avgs.get('reb', 0)
            ast = season_avgs.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast
        return None


# Register signal with global registry
registry.register(CLVTrackerSignal())
