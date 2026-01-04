
from typing import Tuple, List
import pandas as pd
import numpy as np
from ..features.player_features import PlayerFeatures

class MinutesModel:
    """
    Project player minutes based on historical data and game context.
    """
    
    def project_minutes(
        self,
        features: PlayerFeatures,
        spread: float,
        opp_pace_rank: int = 15, # 1-30, 15 is avg
        teammate_injuries: List[str] = None
    ) -> Tuple[float, float]:
        """
        Returns (mean_minutes, std_minutes)
        """
        # 1. Base Minutes Estimate using weighted averages
        # Recency bias is good for rotations
        base_minutes = (
            0.4 * features.minutes_season +
            0.4 * features.minutes_l5 +
            0.2 * features.minutes_l10
        )
        
        # 2. Situational Adjustments
        # Pace: If opponent is fast (rank < 10), starters might play slightly more 
        # (games have more possessions, but length is same... actually pace increases stats per minute, 
        # but pure minutes? Fast games can be tiring. 
        # Standard theory: Pace doesn't affect minutes much unless it causes blowouts.)
        
        # We'll use spread for blowout risk.
        blowout_risk = min(abs(spread) / 15.0, 1.0) # > 15 pt spread = high risk
        
        # In blowouts, starters play less.
        # If risk is 1.0 (very high), reduce minutes by 10-15%?
        if blowout_risk > 0.4:
            # Linear reduction for blowout risk
            blowout_factor = 1.0 - (blowout_risk - 0.4) * 0.2
            base_minutes *= blowout_factor
            
            # Increase variance significantly in blowout games
            std_multiplier = 1.0 + blowout_risk
        else:
            std_multiplier = 1.0
            
        # 3. Teammate Injury Impact
        # If key players are out, minutes condense.
        if teammate_injuries:
            # Simple heuristic: +1-2 minutes for each injured rotation player?
            # We don't know who is rotation without depth chart data.
            # Assume passed injuries are relevant.
            base_minutes += len(teammate_injuries) * 1.5
            
        # Hard caps
        base_minutes = min(base_minutes, 44.0)
        base_minutes = max(base_minutes, 0.0)
        
        # 4. Variance Estimation
        # Use historical std dev if stable, else default
        hist_std = features.minutes_std if features.minutes_std > 0 else 3.5
        
        predicted_std = hist_std * std_multiplier
        
        return base_minutes, predicted_std
