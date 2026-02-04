"""
Defense vs Position Signal

Detects favorable/unfavorable matchups based on opponent's
defense against the player's position.

This is a key edge - some teams are weak against guards, others against bigs.
Example: Washington allows +10% to all positions (bad defense overall)
"""

from typing import Dict, Any, Optional
from .base import BaseSignal, SignalResult, registry


class DefenseVsPositionSignal(BaseSignal):
    """
    Adjust based on opponent defense vs player's position.

    Context required:
        - player_position: str ('G', 'F', 'C', 'PG', 'SG', 'SF', 'PF', 'C')
        - opponent_def_vs_position: Dict[str, Dict[str, float]]
          Example: {'G': {'pts': 1.06}, 'F': {'pts': 0.98}, 'C': {'pts': 0.94}}
          OR
        - opponent_team: str (e.g., 'BOS', 'WAS') for built-in lookups

    Adjustment:
        - baseline × (matchup_factor - 1.0)
        - Only fires when matchup factor >= 1.03 or <= 0.97
    """

    name = "defense"
    description = "Opponent defense vs position matchup"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.58

    # Minimum matchup factor deviation to fire signal
    MIN_MATCHUP_THRESHOLD = 0.01  # 1% (was 3%)

    # Default positional defense ratings (can be overridden by context)
    # These should match matchup_features.py defaults
    DEFAULT_DEFENSE_RATINGS = {
        "BOS": {  # Elite defense
            "G": {'pts': 0.92, 'ast': 0.94, 'reb': 0.98, 'stl': 0.95, 'blk': 0.97, 'tov': 0.93},
            "F": {'pts': 0.94, 'ast': 1.00, 'reb': 0.96, 'stl': 0.96, 'blk': 0.94, 'tov': 0.94},
            "C": {'pts': 0.90, 'ast': 1.05, 'reb': 0.93, 'stl': 0.98, 'blk': 0.92, 'tov': 0.95}
        },
        "GSW": {  # Vulnerable to guards
            "G": {'pts': 1.06, 'ast': 1.04, 'reb': 1.02, 'stl': 1.03, 'blk': 1.00, 'tov': 1.04},
            "F": {'pts': 0.98, 'ast': 0.99, 'reb': 1.01, 'stl': 1.00, 'blk': 0.99, 'tov': 1.01},
            "C": {'pts': 0.94, 'ast': 1.00, 'reb': 0.97, 'stl': 0.98, 'blk': 0.96, 'tov': 0.99}
        },
        "PHX": {  # Vulnerable to bigs
            "G": {'pts': 1.00, 'ast': 1.02, 'reb': 0.98, 'stl': 1.01, 'blk': 1.00, 'tov': 1.02},
            "F": {'pts': 1.04, 'ast': 1.01, 'reb': 1.05, 'stl': 1.02, 'blk': 1.03, 'tov': 1.03},
            "C": {'pts': 1.08, 'ast': 0.98, 'reb': 1.10, 'stl': 1.00, 'blk': 1.06, 'tov': 1.05}
        },
        "WAS": {  # Bad defense overall
            "G": {'pts': 1.10, 'ast': 1.08, 'reb': 1.04, 'stl': 1.06, 'blk': 1.02, 'tov': 1.08},
            "F": {'pts': 1.08, 'ast': 1.05, 'reb': 1.06, 'stl': 1.05, 'blk': 1.04, 'tov': 1.06},
            "C": {'pts': 1.06, 'ast': 1.02, 'reb': 1.08, 'stl': 1.03, 'blk': 1.05, 'tov': 1.04}
        },
        "SAC": {  # Fast pace, average defense
            "G": {'pts': 1.02, 'ast': 1.04, 'reb': 1.00, 'stl': 1.02, 'blk': 1.00, 'tov': 1.03},
            "F": {'pts': 1.01, 'ast': 1.02, 'reb': 1.02, 'stl': 1.01, 'blk': 1.01, 'tov': 1.02},
            "C": {'pts': 1.00, 'ast': 1.00, 'reb': 1.03, 'stl': 1.00, 'blk': 1.02, 'tov': 1.01}
        },
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate defense vs position adjustment."""

        # Get player position
        player_pos = self._normalize_position(context.get('player_position'))
        if player_pos is None:
            return self._create_neutral_result()

        # Get matchup factor
        matchup_factor = self._get_matchup_factor(stat_type, player_pos, context)
        if matchup_factor is None:
            return self._create_neutral_result()

        # Calculate deviation from neutral (1.0)
        matchup_diff = matchup_factor - 1.0

        # Check if matchup is significant
        if abs(matchup_diff) < self.MIN_MATCHUP_THRESHOLD:
            return self._create_neutral_result()

        # Get baseline
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Calculate adjustment
        adjustment = baseline * matchup_diff

        # Determine direction
        if matchup_diff > 0:
            direction = 'OVER'
            matchup_type = 'GOOD_MATCHUP'
        else:
            direction = 'UNDER'
            matchup_type = 'BAD_MATCHUP'

        # Scale confidence by matchup magnitude
        confidence = min(0.52 + abs(matchup_diff) * 2, 0.70)

        opponent_team = context.get('opponent_team', context.get('opponent', 'UNK'))

        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'player_position': player_pos,
                'opponent_team': opponent_team,
                'matchup_factor': matchup_factor,
                'matchup_diff': matchup_diff,
                'matchup_type': matchup_type,
                'baseline': baseline,
            },
            sample_size=25,  # Based on opponent's games vs position
        )

    def _normalize_position(self, position: Optional[str]) -> Optional[str]:
        """Normalize position to G/F/C."""
        if position is None:
            return None

        position = position.upper()

        # Map specific positions to general
        if position in ('PG', 'SG', 'G', 'GUARD'):
            return 'G'
        elif position in ('SF', 'PF', 'F', 'FORWARD'):
            return 'F'
        elif position in ('C', 'CENTER'):
            return 'C'

        return None

    def _get_matchup_factor(
        self,
        stat_type: str,
        player_pos: str,
        context: Dict[str, Any]
    ) -> Optional[float]:
        """Get matchup factor for stat type and position."""

        stat_key = self._stat_to_key(stat_type)

        # First, try context-provided defense ratings
        opp_def = context.get('opponent_def_vs_position') or {}
        if player_pos in opp_def:
            pos_def = opp_def[player_pos]
            if isinstance(pos_def, dict) and stat_key in pos_def:
                return pos_def[stat_key]

        # Try opponent team lookup
        opponent_team = context.get('opponent_team', context.get('opponent'))
        if opponent_team and opponent_team in self.DEFAULT_DEFENSE_RATINGS:
            team_def = self.DEFAULT_DEFENSE_RATINGS[opponent_team]
            if player_pos in team_def:
                pos_def = team_def[player_pos]
                if stat_key in pos_def:
                    return pos_def[stat_key]

        return None

    def _stat_to_key(self, stat_type: str) -> str:
        """Map stat type to defense rating key."""
        stat_key_map = {
            'Points': 'pts',
            'Rebounds': 'reb',
            'Assists': 'ast',
            '3-Pointers Made': 'pts',  # Use points as proxy
            'Pts+Rebs+Asts': 'pts',    # Use points as primary
            'Steals': 'stl',
            'Blocks': 'blk',
            'Turnovers': 'tov',
            'Pts+Rebs': 'pts',
            'Pts+Asts': 'pts',
            'Rebs+Asts': 'reb',
        }
        return stat_key_map.get(stat_type, 'pts')

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        from .stat_helpers import get_baseline
        return get_baseline(stat_type, context)


# Register signal with global registry
registry.register(DefenseVsPositionSignal())
