
import pandas as pd
import numpy as np
from typing import Dict, Optional

class TeamFeatureEngineer:
    """
    Engineer team-level features
    """
    
    def calculate_team_metrics(self, team_id: int, game_log: pd.DataFrame) -> Dict:
        """
        Calculate metrics for a team based on their game log
        """
        if game_log.empty:
            return self._get_default_metrics()
            
        # Calculate possessions (approximate)
        # Poss = 0.5 * ((Tm FGA + 0.4 * Tm FTA - 1.07 * (Tm ORB / (Tm ORB + Opp DRB)) * (Tm FGA - Tm FG) + Tm TOV) 
        #             + (Opp FGA + 0.4 * Opp FTA - 1.07 * (Opp ORB / (Opp ORB + Tm DRB)) * (Opp FGA - Opp FG) + Opp TOV))
        # For simplicity in this version, we'll use a simpler pace estimate if advanced stats aren't present
        
        # Check if we have advanced stats columns
        has_adv = 'PACE' in game_log.columns
        
        if has_adv:
            pace = game_log['PACE'].mean()
            off_rating = game_log['OFF_RATING'].mean()
            def_rating = game_log['DEF_RATING'].mean()
        else:
            # Fallback to simple estimates or generic averages
            # Estimate pace from FGA + TOV + 0.44 * FTA
            possessions = (
                game_log['FGA'] + 
                game_log['TOV'] + 
                0.44 * game_log['FTA']
            )
            minutes = game_log['MIN'] / 5  # MIN is total player minutes usually ~240
            pace = (possessions / minutes) * 48
            pace = pace.mean()
            
            # Approximate ratings
            pts = game_log['PTS'].mean()
            off_rating = (pts / pace) * 100 if pace > 0 else 110.0
            def_rating = 110.0 # Without opponent score in player logs, hard to calc def rating
            
        return {
            'team_pace': float(pace),
            'team_off_rating': float(off_rating),
            'team_def_rating': float(def_rating),
            'team_ast_pct': float(game_log['AST'].sum() / game_log['FGM'].sum()) if game_log['FGM'].sum() > 0 else 0.6,
            'team_orb_pct': 0.25, # Placeholder/Default
        }

    def _get_default_metrics(self) -> Dict:
        return {
            'team_pace': 100.0,
            'team_off_rating': 112.0,
            'team_def_rating': 112.0,
            'team_ast_pct': 0.60,
            'team_orb_pct': 0.25
        }
