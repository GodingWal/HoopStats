"""
Line Movement Signal

Uses line movement direction and magnitude as a predictive signal.
Sharp money moves lines — if a line moves significantly, that's information.

Key patterns:
- Steam moves (rapid multi-book movement) are highly informative
- Reverse line movement (public on one side, line moves other way) indicates sharp action
- Gradual drift is less informative than sudden moves

Context required:
    - opening_line: float
    - current_line: float
    - line_history: List[Dict] with timestamped line snapshots (optional)
    - public_betting_pct: float (optional, % of public on OVER)
"""

from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry


class LineMovementSignal(BaseSignal):
    """
    Adjust projections based on line movement patterns.

    Sharp bettors move lines early; the public bets later.
    When lines move against public sentiment, it signals sharp action.
    """

    name = "line_movement"
    description = "Line movement and sharp money detection"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.58

    # Movement thresholds
    MIN_MOVE = 0.5        # Minimum movement to consider
    SIGNIFICANT_MOVE = 1.0  # Meaningful movement
    STEAM_MOVE = 1.5       # Steam move threshold
    MASSIVE_MOVE = 2.5     # Very large movement

    # Reverse line movement (RLM) confidence boost
    RLM_CONFIDENCE_BOOST = 0.10

    # Public betting threshold for RLM detection
    PUBLIC_THRESHOLD = 0.60  # 60% of public on one side

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate line movement adjustment."""

        opening_line = context.get('opening_line')
        current_line = context.get('current_line')

        if opening_line is None or current_line is None:
            return self._create_neutral_result()

        # Calculate movement
        line_move = current_line - opening_line
        abs_move = abs(line_move)

        if abs_move < self.MIN_MOVE:
            return self._create_neutral_result()

        # Determine movement direction interpretation
        # Line went UP → market expects more → OVER is now harder
        # Line went DOWN → market expects less → UNDER is now harder
        # The SHARP side is where the line moved TO (sharp money moved it)

        if line_move > 0:
            # Line went up - sharp money on OVER (they bet over, books raised line)
            sharp_direction = 'OVER'
        else:
            # Line went down - sharp money on UNDER
            sharp_direction = 'UNDER'

        # Check for reverse line movement
        is_rlm = self._detect_reverse_line_movement(line_move, context)

        # Analyze movement velocity if history available
        velocity_factor = self._analyze_movement_velocity(context)

        # Calculate adjustment magnitude
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Scale adjustment by movement magnitude
        if abs_move >= self.MASSIVE_MOVE:
            adjustment_pct = 0.04  # 4% adjustment for massive moves
            base_confidence = 0.68
        elif abs_move >= self.STEAM_MOVE:
            adjustment_pct = 0.03  # 3% for steam moves
            base_confidence = 0.63
        elif abs_move >= self.SIGNIFICANT_MOVE:
            adjustment_pct = 0.02  # 2% for significant moves
            base_confidence = 0.58
        else:
            adjustment_pct = 0.01  # 1% for small moves
            base_confidence = 0.52

        adjustment = baseline * adjustment_pct
        if sharp_direction == 'UNDER':
            adjustment = -adjustment

        # Apply velocity factor
        adjustment *= velocity_factor

        # Boost confidence for RLM
        confidence = base_confidence
        if is_rlm:
            confidence = min(confidence + self.RLM_CONFIDENCE_BOOST, 0.75)

        # Classify move type
        if is_rlm:
            move_type = 'REVERSE_LINE_MOVEMENT'
        elif abs_move >= self.STEAM_MOVE:
            move_type = 'STEAM_MOVE'
        elif abs_move >= self.SIGNIFICANT_MOVE:
            move_type = 'SIGNIFICANT'
        else:
            move_type = 'MINOR'

        return self._create_result(
            adjustment=adjustment,
            direction=sharp_direction,
            confidence=confidence,
            metadata={
                'opening_line': opening_line,
                'current_line': current_line,
                'line_move': line_move,
                'abs_move': abs_move,
                'move_type': move_type,
                'sharp_direction': sharp_direction,
                'is_reverse_line_movement': is_rlm,
                'velocity_factor': velocity_factor,
                'public_betting_pct': context.get('public_betting_pct'),
            },
            sample_size=1,
        )

    def _detect_reverse_line_movement(
        self,
        line_move: float,
        context: Dict[str, Any]
    ) -> bool:
        """
        Detect reverse line movement.

        RLM occurs when the public is heavily on one side but the line
        moves the other way, indicating sharp action.
        """
        public_pct = context.get('public_betting_pct')
        if public_pct is None:
            return False

        # Public heavily on OVER but line went down (or vice versa)
        public_on_over = public_pct >= self.PUBLIC_THRESHOLD
        public_on_under = (1 - public_pct) >= self.PUBLIC_THRESHOLD

        if public_on_over and line_move < -self.MIN_MOVE:
            # Public on over, line went down → RLM (sharp on under)
            return True
        elif public_on_under and line_move > self.MIN_MOVE:
            # Public on under, line went up → RLM (sharp on over)
            return True

        return False

    def _analyze_movement_velocity(self, context: Dict[str, Any]) -> float:
        """
        Analyze how quickly the line moved.

        Rapid movement = more informative (steam)
        Gradual drift = less informative

        Returns a multiplier (0.8 - 1.3)
        """
        line_history = context.get('line_history', [])
        if len(line_history) < 3:
            return 1.0  # No velocity data, neutral

        # Check if most movement happened in a short window
        try:
            # Sort by timestamp
            sorted_history = sorted(line_history, key=lambda x: x.get('timestamp', ''))
            first_line = sorted_history[0].get('line', 0)
            last_line = sorted_history[-1].get('line', 0)
            total_move = abs(last_line - first_line)

            if total_move < self.MIN_MOVE:
                return 1.0

            # Check if > 70% of movement happened in first 30% of time window
            cutoff_idx = max(1, len(sorted_history) // 3)
            early_line = sorted_history[cutoff_idx].get('line', first_line)
            early_move = abs(early_line - first_line)

            early_pct = early_move / total_move if total_move > 0 else 0

            if early_pct > 0.70:
                return 1.2  # Rapid early movement (steam-like)
            elif early_pct < 0.30:
                return 0.9  # Gradual drift (less informative)
            else:
                return 1.0  # Normal movement

        except (KeyError, IndexError, TypeError):
            return 1.0

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
registry.register(LineMovementSignal())
