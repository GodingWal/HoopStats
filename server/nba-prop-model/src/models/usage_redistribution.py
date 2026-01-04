
from typing import Dict, List
import pandas as pd

class UsageRedistributionModel:
    """
    Adjust player metrics when teammates are absent.
    """
    
    def calculate_redistribution(
        self,
        player_name: str,
        teammate_injuries: List[str]
    ) -> Dict[str, float]:
        """
        Calculate boosts for various stats due to missing teammates
        """
        if not teammate_injuries:
            return {
                'usage_boost': 1.0,
                'scoring_boost': 1.0,
                'assist_boost': 1.0,
                'rebound_boost': 1.0
            }
            
        # In a real model, we would look up specific "With/Without" splits
        # e.g. "Luka Doncic stats without Kyrie Irving"
        
        # For this version, we apply generic usage gravity principles
        
        # Each missing player leaves a void of USG% and Possessions
        # We assume the void is filled by remaining starters.
        
        # Default boosts per missing player (very rough heuristic)
        # Usage usually goes UP (+3-5%)
        # Efficiency usually goes DOWN (-2%)
        # Assists might go UP (more ball handling) or DOWN (less finishers)
        
        num_injured = len(teammate_injuries)
        
        return {
            'usage_boost': 1.0 + (0.04 * num_injured),     # +4% usage per missing player
            'scoring_boost': 1.0 + (0.05 * num_injured),   # +5% scoring (volume outweighs efficiency drop)
            'assist_boost': 1.0 + (0.03 * num_injured),    # +3% assists
            'rebound_boost': 1.0 + (0.02 * num_injured),   # +2% rebounds
        }
