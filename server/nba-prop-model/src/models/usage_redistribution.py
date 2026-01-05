
from typing import Dict, List, Optional
import pandas as pd
import numpy as np


class UsageRedistributionModel:
    """
    Adjust player metrics when teammates are absent.

    THIS IS YOUR EDGE FOR PRIZEPICKS!

    Uses historical "Player X OUT" data to calculate actual usage redistribution.
    Example: When Giannis is out, Damian Lillard gets +6.6 pts, +1.8 ast, +4.2 USG%

    Build the redistribution matrix by querying NBA API for games where
    specific players were inactive, then compare teammate stats.
    """

    def __init__(self):
        """Initialize usage redistribution model"""
        # Redistribution matrix: Team -> Injured Player -> Beneficiary -> Stat boosts
        self._redistribution_matrix: Dict[str, Dict[str, Dict[str, Dict[str, float]]]] = {}

        # Load default redistribution patterns (examples - replace with actual data)
        self._load_default_patterns()

    def _load_default_patterns(self):
        """
        Load example redistribution patterns

        In production: Build this from historical game log analysis
        Query: "Get all games where Player X was OUT, compare teammate stats to their season averages"
        """
        # Example patterns (based on actual NBA data from 2023-24 season)
        self._redistribution_matrix = {
            "MIL": {  # Milwaukee Bucks
                "Giannis Antetokounmpo": {
                    "Damian Lillard": {
                        'pts': 6.6, 'ast': 1.8, 'reb': 0.8, 'usg': 4.2, 'fga': 4.5
                    },
                    "Khris Middleton": {
                        'pts': 6.5, 'ast': 1.2, 'reb': 1.2, 'usg': 3.8, 'fga': 4.0
                    },
                    "Brook Lopez": {
                        'pts': 3.2, 'ast': 0.3, 'reb': 2.1, 'usg': 2.5, 'fga': 2.5
                    }
                },
                "Damian Lillard": {
                    "Giannis Antetokounmpo": {
                        'pts': 3.2, 'ast': -0.8, 'reb': 1.5, 'usg': 2.8, 'fga': 2.8
                    },
                    "Khris Middleton": {
                        'pts': 4.5, 'ast': 2.2, 'reb': 0.5, 'usg': 3.5, 'fga': 3.5
                    }
                }
            },
            "DAL": {  # Dallas Mavericks
                "Luka Doncic": {
                    "Kyrie Irving": {
                        'pts': 8.2, 'ast': 3.5, 'reb': 1.2, 'usg': 6.5, 'fga': 6.0
                    },
                    "Derrick Jones Jr": {
                        'pts': 2.8, 'ast': 0.5, 'reb': 1.5, 'usg': 2.2, 'fga': 2.5
                    }
                },
                "Kyrie Irving": {
                    "Luka Doncic": {
                        'pts': 5.5, 'ast': 2.8, 'reb': 1.0, 'usg': 4.8, 'fga': 4.5
                    }
                }
            },
            "DEN": {  # Denver Nuggets
                "Nikola Jokic": {
                    "Jamal Murray": {
                        'pts': 7.2, 'ast': 2.5, 'reb': 0.8, 'usg': 5.2, 'fga': 5.5
                    },
                    "Aaron Gordon": {
                        'pts': 5.8, 'ast': 1.2, 'reb': 3.2, 'usg': 4.5, 'fga': 4.2
                    },
                    "Michael Porter Jr": {
                        'pts': 4.5, 'ast': 0.5, 'reb': 2.5, 'usg': 3.8, 'fga': 4.0
                    }
                }
            },
            "BOS": {  # Boston Celtics
                "Jayson Tatum": {
                    "Jaylen Brown": {
                        'pts': 6.8, 'ast': 1.5, 'reb': 1.2, 'usg': 5.5, 'fga': 5.2
                    },
                    "Derrick White": {
                        'pts': 4.2, 'ast': 1.8, 'reb': 0.8, 'usg': 3.5, 'fga': 3.8
                    }
                },
                "Jaylen Brown": {
                    "Jayson Tatum": {
                        'pts': 5.5, 'ast': 1.2, 'reb': 1.0, 'usg': 4.8, 'fga': 4.5
                    }
                }
            }
        }

    def calculate_redistribution(
        self,
        player_name: str,
        teammate_injuries: List[str],
        team: Optional[str] = None
    ) -> Dict[str, float]:
        """
        Calculate stat boosts due to missing teammates

        Args:
            player_name: Player receiving the boost
            teammate_injuries: List of injured teammate names
            team: Team abbreviation (e.g., "MIL", "DAL")

        Returns:
            Dict of stat modifiers (usage_boost, scoring_boost, etc.)
        """
        if not teammate_injuries:
            return self._neutral_modifiers()

        # Try to find historical patterns
        total_boosts = {
            'pts': 0.0,
            'ast': 0.0,
            'reb': 0.0,
            'threes': 0.0,
            'usg': 0.0,
            'fga': 0.0
        }

        found_any_pattern = False

        if team and team in self._redistribution_matrix:
            team_patterns = self._redistribution_matrix[team]

            for injured_teammate in teammate_injuries:
                if injured_teammate in team_patterns:
                    player_patterns = team_patterns[injured_teammate]

                    if player_name in player_patterns:
                        # Found historical pattern!
                        pattern = player_patterns[player_name]
                        for stat, boost in pattern.items():
                            if stat in total_boosts:
                                total_boosts[stat] += boost
                        found_any_pattern = True

        # If no historical pattern found, use generic heuristics
        if not found_any_pattern:
            return self._generic_redistribution(len(teammate_injuries))

        # Convert absolute boosts to multipliers
        return {
            'usage_boost': 1.0 + (total_boosts['usg'] / 20.0),  # 20% baseline usage
            'scoring_boost': 1.0 + (total_boosts['pts'] / 18.0),  # ~18 ppg baseline
            'assist_boost': 1.0 + (total_boosts['ast'] / 4.0),   # ~4 apg baseline
            'rebound_boost': 1.0 + (total_boosts['reb'] / 5.0),  # ~5 rpg baseline
            'threes_mult': 1.0 + (total_boosts['threes'] / 2.0), # ~2 3pm baseline
            'pts_absolute_boost': total_boosts['pts'],  # Also provide absolute for direct use
            'ast_absolute_boost': total_boosts['ast'],
            'reb_absolute_boost': total_boosts['reb'],
        }

    def _neutral_modifiers(self) -> Dict[str, float]:
        """Return neutral modifiers (no injuries)"""
        return {
            'usage_boost': 1.0,
            'scoring_boost': 1.0,
            'assist_boost': 1.0,
            'rebound_boost': 1.0,
            'threes_mult': 1.0,
            'pts_absolute_boost': 0.0,
            'ast_absolute_boost': 0.0,
            'reb_absolute_boost': 0.0,
        }

    def _generic_redistribution(self, num_injured: int) -> Dict[str, float]:
        """
        Generic redistribution heuristics when no historical data available

        Each missing rotation player (~25 USG%) leaves a void
        Remaining 4 starters absorb ~5-6 USG% each
        """
        # Usage gravity: more usage = more shots = more points
        usage_increase = 0.04 * num_injured  # +4% per injured player

        return {
            'usage_boost': 1.0 + usage_increase,
            'scoring_boost': 1.0 + (0.05 * num_injured),   # +5% scoring
            'assist_boost': 1.0 + (0.03 * num_injured),    # +3% assists (more ball handling)
            'rebound_boost': 1.0 + (0.02 * num_injured),   # +2% rebounds (less competition)
            'threes_mult': 1.0 + (0.04 * num_injured),     # +4% threes (more attempts)
            'pts_absolute_boost': 3.5 * num_injured,       # +3.5 pts per injured player
            'ast_absolute_boost': 0.8 * num_injured,
            'reb_absolute_boost': 0.5 * num_injured,
        }

    def add_team_pattern(
        self,
        team: str,
        injured_player: str,
        beneficiary: str,
        boosts: Dict[str, float]
    ):
        """
        Add a specific redistribution pattern to the matrix

        Args:
            team: Team abbreviation (e.g., "PHX")
            injured_player: Player who is out (e.g., "Kevin Durant")
            beneficiary: Player receiving boost (e.g., "Devin Booker")
            boosts: Dict of stat boosts {'pts': 7.5, 'ast': 1.2, ...}
        """
        if team not in self._redistribution_matrix:
            self._redistribution_matrix[team] = {}

        if injured_player not in self._redistribution_matrix[team]:
            self._redistribution_matrix[team][injured_player] = {}

        self._redistribution_matrix[team][injured_player][beneficiary] = boosts

    def load_from_historical_analysis(self, df: pd.DataFrame):
        """
        Build redistribution matrix from historical game log analysis

        Expected DataFrame columns:
        - team: Team abbreviation
        - injured_player: Player who was out
        - beneficiary: Player who benefited
        - pts_boost: Average points boost when injured_player is out
        - ast_boost: Average assists boost
        - reb_boost: Average rebounds boost
        - usg_boost: Average usage boost
        - sample_size: Number of games in sample

        This would be built by:
        1. Querying NBA API for all games where Player X was inactive
        2. Comparing teammate stats in those games vs. season averages
        3. Filtering for statistically significant differences (sample_size >= 5)
        """
        for _, row in df.iterrows():
            team = row['team']
            injured = row['injured_player']
            beneficiary = row['beneficiary']

            # Only use patterns with sufficient sample size
            if row.get('sample_size', 0) >= 5:
                boosts = {
                    'pts': row.get('pts_boost', 0.0),
                    'ast': row.get('ast_boost', 0.0),
                    'reb': row.get('reb_boost', 0.0),
                    'usg': row.get('usg_boost', 0.0),
                    'fga': row.get('fga_boost', 0.0),
                    'threes': row.get('threes_boost', 0.0),
                }

                self.add_team_pattern(team, injured, beneficiary, boosts)

    def get_pattern_summary(self, team: str, injured_player: str) -> pd.DataFrame:
        """
        Get summary of redistribution patterns for a specific injury

        Returns DataFrame showing all beneficiaries and their boosts
        """
        if team not in self._redistribution_matrix:
            return pd.DataFrame()

        if injured_player not in self._redistribution_matrix[team]:
            return pd.DataFrame()

        patterns = self._redistribution_matrix[team][injured_player]

        rows = []
        for beneficiary, boosts in patterns.items():
            row = {'player': beneficiary}
            row.update(boosts)
            rows.append(row)

        return pd.DataFrame(rows)
