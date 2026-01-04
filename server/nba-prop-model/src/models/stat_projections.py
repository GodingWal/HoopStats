
from typing import Dict, Tuple, Optional
import numpy as np
from ..features.player_features import PlayerFeatures

class StatProjectionModel:
    """
    Logic for projecting specific stats (PTS, REB, AST, etc.)
    Independent of the joint distribution logic.
    """
    
    def project_stat(
        self,
        stat_name: str,
        features: PlayerFeatures,
        minutes: float,
        modifiers: Dict[str, float]
    ) -> Tuple[float, float]:
        """
        Project a single stat (Mean, Std)
        """
        # 1. Get Base Rate (per minute)
        if stat_name == 'points':
            # Weighted average of rates
            rate = 0.5 * features.pts_per_min + 0.3 * features.pts_per_min_l5 + 0.2 * (features.career_ppg / 36.0 if features.career_ppg else features.pts_per_min)
            # Apply usage boost if exists
            rate *= modifiers.get('usage_boost', 1.0)
            
        elif stat_name == 'rebounds':
            rate = features.reb_per_min
            rate *= modifiers.get('rebound_boost', 1.0)
            
        elif stat_name == 'assists':
            rate = features.ast_per_min
            rate *= modifiers.get('assist_boost', 1.0)
            
        elif stat_name == 'threes':
            rate = features.three_pm_per_min
            rate *= modifiers.get('usage_boost', 1.0) # Threes correlate with usage
            
        else:
            # Generic fallback
            return 0.0, 0.0

        # 2. Apply Matchup Modifiers
        # e.g. points_mult from matchup features
        matchup_mult = modifiers.get(f'{stat_name}_mult', 1.0)
        
        # 3. Calculate Mean
        mean_proj = rate * minutes * matchup_mult
        
        # 4. Calculate Deviation
        # Use player's historical consistency (CV - Coefficient of Variation)
        # CV = Std / Mean
        
        if stat_name == 'points':
            hist_cv = features.pts_std / (features.pts_per_min * features.minutes_season) if features.minutes_season > 0 else 0.3
        elif stat_name == 'rebounds':
            hist_cv = features.reb_std / (features.reb_per_min * features.minutes_season) if features.minutes_season > 0 else 0.4
        else:
            hist_cv = 0.4 # Default
            
        # Clamp CV to reasonable bounds [0.2, 0.6] to prevent wild variance
        hist_cv = max(0.2, min(hist_cv, 0.6))
        
        std_proj = mean_proj * hist_cv
        
        return mean_proj, std_proj
