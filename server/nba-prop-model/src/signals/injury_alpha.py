"""
Injury Alpha Signal

THE EDGE SIGNAL - Detects when a star teammate is OUT and calculates
the usage/stats redistribution to remaining players.

This is one of the most predictable and significant adjustments.
Example: Giannis OUT → Dame gets +6.6 pts, +1.8 ast

Uses pre-calculated redistribution patterns from historical data.
"""

from typing import Dict, Any, Optional, List, Union
from .base import BaseSignal, SignalResult, registry


class InjuryAlphaSignal(BaseSignal):
    """
    Calculate stats boost from injured/out teammates.

    Context required:
        - injured_teammates: List[str] of injured player names OR
          Dict[str, float] mapping names to minutes
        - usage_redistribution: Dict with pre-calculated boosts (from usage_redistribution.py)
          OR
        - team: str team abbreviation for built-in patterns

    This signal uses the UsageRedistributionModel patterns when available.
    Falls back to generic heuristics when no historical data exists.
    """

    name = "injury_alpha"
    description = "Stats boost from injured star teammates"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.70  # High confidence - injuries are predictable

    # Default redistribution patterns (should match usage_redistribution.py)
    DEFAULT_PATTERNS = {
        "MIL": {
            "Giannis Antetokounmpo": {
                "Damian Lillard": {'pts': 6.6, 'ast': 1.8, 'reb': 0.8},
                "Khris Middleton": {'pts': 6.5, 'ast': 1.2, 'reb': 1.2},
                "Brook Lopez": {'pts': 3.2, 'ast': 0.3, 'reb': 2.1},
            },
            "Damian Lillard": {
                "Giannis Antetokounmpo": {'pts': 3.2, 'ast': -0.8, 'reb': 1.5},
                "Khris Middleton": {'pts': 4.5, 'ast': 2.2, 'reb': 0.5},
            }
        },
        "DAL": {
            "Luka Doncic": {
                "Kyrie Irving": {'pts': 8.2, 'ast': 3.5, 'reb': 1.2},
                "Derrick Jones Jr": {'pts': 2.8, 'ast': 0.5, 'reb': 1.5},
            },
            "Kyrie Irving": {
                "Luka Doncic": {'pts': 5.5, 'ast': 2.8, 'reb': 1.0},
            }
        },
        "DEN": {
            "Nikola Jokic": {
                "Jamal Murray": {'pts': 7.2, 'ast': 2.5, 'reb': 0.8},
                "Aaron Gordon": {'pts': 5.8, 'ast': 1.2, 'reb': 3.2},
                "Michael Porter Jr": {'pts': 4.5, 'ast': 0.5, 'reb': 2.5},
            }
        },
        "BOS": {
            "Jayson Tatum": {
                "Jaylen Brown": {'pts': 6.8, 'ast': 1.5, 'reb': 1.2},
                "Derrick White": {'pts': 4.2, 'ast': 1.8, 'reb': 0.8},
            },
            "Jaylen Brown": {
                "Jayson Tatum": {'pts': 5.5, 'ast': 1.2, 'reb': 1.0},
            }
        }
    }

    # Generic fallback when no historical data
    GENERIC_BOOST_PER_INJURED = {
        'pts': 3.5,
        'ast': 0.8,
        'reb': 0.5,
        'fg3m': 0.4,
        'stl': 0.2,
        'blk': 0.1,
        'tov': 0.3,
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate injury-based adjustment."""

        # Get injured teammates
        injured_teammates = context.get('injured_teammates') or []
        if not injured_teammates:
            return self._create_neutral_result()

        # Normalize to list of names
        if isinstance(injured_teammates, dict):
            injured_names = list(injured_teammates.keys())
        else:
            injured_names = injured_teammates

        if not injured_names:
            return self._create_neutral_result()

        # Get player name for pattern lookup
        player_name = context.get('player_name', '')

        # Try to get redistribution from context first
        total_boost = self._calculate_boost(
            player_name=player_name,
            injured_names=injured_names,
            stat_type=stat_type,
            context=context
        )

        if total_boost == 0:
            return self._create_neutral_result()

        # Determine direction
        direction = 'OVER' if total_boost > 0 else 'UNDER'

        # Higher confidence with known patterns
        has_known_pattern = self._has_known_pattern(player_name, injured_names, context)
        confidence = 0.72 if has_known_pattern else 0.55

        return self._create_result(
            adjustment=total_boost,
            direction=direction,
            confidence=confidence,
            metadata={
                'injured_teammates': injured_names,
                'player_name': player_name,
                'has_known_pattern': has_known_pattern,
                'boost_per_stat': self._get_detailed_boosts(player_name, injured_names, context),
            },
            sample_size=15 if has_known_pattern else 5,
        )

    def _calculate_boost(
        self,
        player_name: str,
        injured_names: List[str],
        stat_type: str,
        context: Dict[str, Any]
    ) -> float:
        """Calculate total boost for the stat type."""

        stat_key = self._stat_to_key(stat_type)
        total_boost = 0.0

        # Try context-provided redistribution first
        redistribution = context.get('usage_redistribution') or {}
        team = context.get('team', '')

        for injured_player in injured_names:
            # Check context redistribution
            if injured_player in redistribution:
                pattern = redistribution[injured_player]
                if isinstance(pattern, dict):
                    boost = pattern.get(f'{stat_key}_boost', pattern.get(stat_key, 0))
                    total_boost += boost
                    continue

            # Check default patterns
            boost = self._get_default_boost(team, injured_player, player_name, stat_key)
            if boost is not None:
                total_boost += boost
            else:
                # Generic fallback
                generic_boost = self.GENERIC_BOOST_PER_INJURED.get(stat_key, 0)
                total_boost += generic_boost * 0.5  # Reduce generic boost uncertainty

        # Handle composite stats
        from .stat_helpers import COMPOSITE_STATS
        if stat_type in COMPOSITE_STATS:
            component_map = {
                'pts': 'Points', 'reb': 'Rebounds', 'ast': 'Assists',
            }
            components = COMPOSITE_STATS[stat_type]
            return sum(
                self._calculate_boost(player_name, injured_names, component_map.get(c, c), context)
                for c in components if c in component_map
            )

        return total_boost

    def _get_default_boost(
        self,
        team: str,
        injured_player: str,
        beneficiary: str,
        stat_key: str
    ) -> Optional[float]:
        """Get boost from default patterns."""

        if team not in self.DEFAULT_PATTERNS:
            return None

        team_patterns = self.DEFAULT_PATTERNS[team]
        if injured_player not in team_patterns:
            return None

        player_patterns = team_patterns[injured_player]
        if beneficiary not in player_patterns:
            return None

        return player_patterns[beneficiary].get(stat_key, 0)

    def _has_known_pattern(
        self,
        player_name: str,
        injured_names: List[str],
        context: Dict[str, Any]
    ) -> bool:
        """Check if we have a known redistribution pattern."""

        team = context.get('team', '')
        redistribution = context.get('usage_redistribution') or {}

        for injured in injured_names:
            # Check context
            if injured in redistribution:
                return True

            # Check defaults
            if team in self.DEFAULT_PATTERNS:
                if injured in self.DEFAULT_PATTERNS[team]:
                    if player_name in self.DEFAULT_PATTERNS[team][injured]:
                        return True

        return False

    def _get_detailed_boosts(
        self,
        player_name: str,
        injured_names: List[str],
        context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Get detailed boost breakdown by stat."""
        return {
            'pts': self._calculate_boost(player_name, injured_names, 'Points', context),
            'reb': self._calculate_boost(player_name, injured_names, 'Rebounds', context),
            'ast': self._calculate_boost(player_name, injured_names, 'Assists', context),
        }

    def _stat_to_key(self, stat_type: str) -> str:
        """Map stat type to boost key."""
        from .stat_helpers import STAT_KEY_MAP
        return STAT_KEY_MAP.get(stat_type, 'pts')


# Register signal with global registry
registry.register(InjuryAlphaSignal())
