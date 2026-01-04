
import pandas as pd
from typing import Dict

class MatchupFeatureEngineer:
    """
    Engineer matchup-related features
    """
    
    def calculate_matchup_adjustments(
        self, 
        player_pos: str, 
        opponent_stats: Dict
    ) -> Dict:
        """
        Calculate multipliers for stats based on matchup
        
        Args:
            player_pos: Player's primary position (G, F, C)
            opponent_stats: Dict containing def_rating, pace, etc.
        """
        
        # 1. Pace Adjustment
        # If opponent plays fast, we get more possessions
        league_pace = 100.0
        opp_pace = opponent_stats.get('pace', league_pace)
        pace_factor = opp_pace / league_pace
        
        # 2. Defensive Rating Adjustment
        # High rating = bad defense (more points)
        league_def_rating = 112.0
        opp_def_rating = opponent_stats.get('def_rating', league_def_rating)
        # For points, scaling is roughly: 1 pt diff in rating ~= 0.5% diff in production
        # Actually standard deviation of team defensive ratings is ~3-4 points.
        # A bad defense (116) vs avg (112) -> +4 diff -> maybe +2-3% scoring.
        defense_factor = 1.0 + (opp_def_rating - league_def_rating) * 0.005
        
        # 3. Position specific adjustments (Concept)
        # In a real model, we'd lookup "Defense vs Position" stats
        # For now, we will use a simplified positional defense factor if provided
        pos_defense_factor = opponent_stats.get(f'def_vs_{player_pos}', 1.0)
        
        return {
            'points_mult': pace_factor * defense_factor * pos_defense_factor,
            'rebounds_mult': pace_factor * opponent_stats.get('opp_reb_allowed_factor', 1.0),
            'assists_mult': pace_factor * opponent_stats.get('opp_ast_allowed_factor', 1.0),
            'threes_mult': pace_factor * opponent_stats.get('opp_3pm_allowed_factor', 1.0),
            'steals_mult': pace_factor, # Steals correlate with possessions
            'blocks_mult': pace_factor,
            'turnovers_mult': pace_factor * opponent_stats.get('opp_tov_forced_factor', 1.0),
            'minutes_mult': 1.0 # Minutes handled separately
        }
