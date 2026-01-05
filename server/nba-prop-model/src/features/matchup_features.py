
import pandas as pd
from typing import Dict, Optional
import numpy as np


class MatchupFeatureEngineer:
    """
    Engineer matchup-related features with positional defensive ratings

    Adds position-specific defensive matchups (e.g., opponent allows X% more points to guards)
    This is critical for finding edges in player props
    """

    def __init__(self):
        """Initialize matchup feature engineer"""
        # Position-specific defensive ratings cache
        # Structure: {team: {position: {stat: vs_league_avg}}}
        self._positional_defense_cache: Dict[str, Dict[str, Dict[str, float]]] = {}

        # Load default positional defense ratings
        self._load_default_positional_defense()

    def _load_default_positional_defense(self):
        """
        Load example positional defense ratings

        In production: Calculate from season data
        Query: For each team, get stats allowed by position vs league average
        """
        # Example: 2024-25 season positional defense (vs league average)
        # Format: {team: {position: {stat_vs_avg}}}
        # 1.08 = allows 8% more than league average
        # 0.95 = allows 5% less than league average

        self._positional_defense_cache = {
            "BOS": {  # Boston (elite defense)
                "G": {'pts': 0.92, 'ast': 0.94, 'reb': 0.98, 'threes': 0.90},
                "F": {'pts': 0.94, 'ast': 1.00, 'reb': 0.96, 'threes': 0.92},
                "C": {'pts': 0.90, 'ast': 1.05, 'reb': 0.93, 'threes': 0.95}
            },
            "GSW": {  # Golden State (vulnerable to guards)
                "G": {'pts': 1.06, 'ast': 1.04, 'reb': 1.02, 'threes': 1.08},
                "F": {'pts': 0.98, 'ast': 0.99, 'reb': 1.01, 'threes': 1.00},
                "C": {'pts': 0.94, 'ast': 1.00, 'reb': 0.97, 'threes': 0.96}
            },
            "PHX": {  # Phoenix (vulnerable to bigs)
                "G": {'pts': 1.00, 'ast': 1.02, 'reb': 0.98, 'threes': 1.02},
                "F": {'pts': 1.04, 'ast': 1.01, 'reb': 1.05, 'threes': 1.01},
                "C": {'pts': 1.08, 'ast': 0.98, 'reb': 1.10, 'threes': 1.00}
            },
            "WAS": {  # Washington (bad defense overall)
                "G": {'pts': 1.10, 'ast': 1.08, 'reb': 1.04, 'threes': 1.12},
                "F": {'pts': 1.08, 'ast': 1.05, 'reb': 1.06, 'threes': 1.09},
                "C": {'pts': 1.06, 'ast': 1.02, 'reb': 1.08, 'threes': 1.02}
            },
            "SAC": {  # Sacramento (fast pace, average defense)
                "G": {'pts': 1.02, 'ast': 1.04, 'reb': 1.00, 'threes': 1.05},
                "F": {'pts': 1.01, 'ast': 1.02, 'reb': 1.02, 'threes': 1.03},
                "C": {'pts': 1.00, 'ast': 1.00, 'reb': 1.03, 'threes': 1.00}
            },
        }

    def calculate_matchup_adjustments(
        self,
        player_pos: str,
        opponent_stats: Dict,
        opponent_team: Optional[str] = None
    ) -> Dict:
        """
        Calculate multipliers for stats based on matchup

        Args:
            player_pos: Player's primary position (G, F, C)
            opponent_stats: Dict containing def_rating, pace, etc.
            opponent_team: Opponent team abbreviation for positional lookups

        Returns:
            Dict of stat multipliers
        """

        # 1. Pace Adjustment
        # If opponent plays fast, we get more possessions
        league_pace = 100.0
        opp_pace = opponent_stats.get('pace', league_pace)
        pace_factor = opp_pace / league_pace

        # 2. Overall Defensive Rating Adjustment
        # High rating = bad defense (more points allowed)
        league_def_rating = 112.0
        opp_def_rating = opponent_stats.get('def_rating', league_def_rating)

        # Nonlinear scaling: elite defenses (< 108) have bigger impact
        if opp_def_rating < 108:
            defense_factor = 1.0 - (108 - opp_def_rating) * 0.008  # Elite defense penalty
        elif opp_def_rating > 116:
            defense_factor = 1.0 + (opp_def_rating - 116) * 0.008  # Bad defense bonus
        else:
            defense_factor = 1.0 + (opp_def_rating - league_def_rating) * 0.005

        # 3. Position-Specific Defense Adjustments (THE EDGE!)
        pos_adjustments = self._get_positional_adjustments(
            opponent_team or "",
            player_pos
        )

        # Combine all factors
        return {
            'points_mult': pace_factor * defense_factor * pos_adjustments['pts'],
            'rebounds_mult': pace_factor * pos_adjustments['reb'] * opponent_stats.get('opp_reb_allowed_factor', 1.0),
            'assists_mult': pace_factor * pos_adjustments['ast'] * opponent_stats.get('opp_ast_allowed_factor', 1.0),
            'threes_mult': pace_factor * pos_adjustments['threes'] * opponent_stats.get('opp_3pm_allowed_factor', 1.0),
            'steals_mult': pace_factor,  # Steals correlate with possessions
            'blocks_mult': pace_factor,
            'turnovers_mult': pace_factor * opponent_stats.get('opp_tov_forced_factor', 1.0),
            'pace_factor': pace_factor,  # Raw pace for reference
            'defense_factor': defense_factor  # Overall defense factor
        }

    def _get_positional_adjustments(
        self,
        opponent_team: str,
        position: str
    ) -> Dict[str, float]:
        """
        Get position-specific defensive adjustments

        Args:
            opponent_team: Opponent team code (e.g., "BOS", "GSW")
            position: Player position ("G", "F", "C")

        Returns:
            Dict of stat adjustments vs league average
        """
        # Check cache
        if opponent_team in self._positional_defense_cache:
            team_defense = self._positional_defense_cache[opponent_team]
            if position in team_defense:
                return team_defense[position]

        # Fallback: neutral adjustments
        return {
            'pts': 1.0,
            'ast': 1.0,
            'reb': 1.0,
            'threes': 1.0,
            'stl': 1.0,
            'blk': 1.0
        }

    def add_positional_defense_rating(
        self,
        team: str,
        position: str,
        stat_adjustments: Dict[str, float]
    ):
        """
        Add or update positional defense rating for a team

        Args:
            team: Team abbreviation
            position: Position ("G", "F", "C")
            stat_adjustments: Dict of {stat: vs_league_avg}
        """
        if team not in self._positional_defense_cache:
            self._positional_defense_cache[team] = {}

        self._positional_defense_cache[team][position] = stat_adjustments

    def load_positional_defense_from_data(self, df: pd.DataFrame):
        """
        Load positional defense ratings from analyzed data

        Expected DataFrame columns:
        - team: Team abbreviation
        - position: Position defended (G, F, C)
        - pts_vs_avg: Points allowed vs league average (1.0 = average)
        - ast_vs_avg: Assists allowed vs league average
        - reb_vs_avg: Rebounds allowed vs league average
        - threes_vs_avg: 3PM allowed vs league average
        - sample_size: Games in sample

        This would be calculated by:
        1. For each team, aggregate opponent stats by player position
        2. Compare to league average by position
        3. Express as multipliers (e.g., 1.08 = allows 8% more)
        """
        for team, team_data in df.groupby('team'):
            for position, pos_data in team_data.groupby('position'):
                if pos_data['sample_size'].iloc[0] >= 10:  # Sufficient sample
                    adjustments = {
                        'pts': pos_data['pts_vs_avg'].iloc[0],
                        'ast': pos_data['ast_vs_avg'].iloc[0],
                        'reb': pos_data['reb_vs_avg'].iloc[0],
                        'threes': pos_data['threes_vs_avg'].iloc[0],
                    }

                    self.add_positional_defense_rating(team, position, adjustments)

    def get_defense_summary(self, team: str) -> pd.DataFrame:
        """
        Get defensive summary for a team across all positions

        Returns DataFrame with positional defense ratings
        """
        if team not in self._positional_defense_cache:
            return pd.DataFrame()

        rows = []
        for position, adjustments in self._positional_defense_cache[team].items():
            row = {'position': position}
            row.update(adjustments)
            rows.append(row)

        return pd.DataFrame(rows)

    def find_favorable_matchups(
        self,
        stat: str,
        threshold: float = 1.05
    ) -> pd.DataFrame:
        """
        Find teams that allow above-average stats

        Args:
            stat: Stat to check ('pts', 'ast', 'reb', 'threes')
            threshold: Minimum vs_avg ratio (e.g., 1.05 = 5% above average)

        Returns:
            DataFrame of favorable matchups
        """
        favorable = []

        for team, positions in self._positional_defense_cache.items():
            for position, adjustments in positions.items():
                if stat in adjustments and adjustments[stat] >= threshold:
                    favorable.append({
                        'team': team,
                        'position': position,
                        'stat': stat,
                        'vs_avg': adjustments[stat],
                        'edge_pct': (adjustments[stat] - 1.0) * 100
                    })

        df = pd.DataFrame(favorable)
        if not df.empty:
            df = df.sort_values('vs_avg', ascending=False)

        return df
