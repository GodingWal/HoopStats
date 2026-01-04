
from typing import Dict

class SituationalFactorEngineer:
    """
    Handle situational factors (B2B, Home/Away, Rest)
    """
    
    def get_situational_adjustments(
        self,
        is_home: bool,
        is_b2b: bool,
        rest_days: int,
        travel_miles: float = 0
    ) -> Dict:
        """
        Calculate multipliers/additives for stats based on situation
        """
        
        # Home court advantage
        # Role players shoot better at home. Stars are more consistent.
        # General adjustment: +2% production at home vs away
        home_factor = 1.02 if is_home else 0.98
        
        # Back-to-back (B2B)
        # Fatigue affects efficiency and potentially minutes
        # Typically -3% efficiency on B2B
        b2b_factor = 0.97 if is_b2b else 1.0
        
        # Rest days
        # Too much rest (rust) or good rest?
        # 1-2 days is optimal. 3+ is "rust" risk? 0 is fatigue.
        # Simplification: treat > 0 as normal.
        
        # Combined efficiency multiplier
        efficiency_mult = home_factor * b2b_factor
        
        return {
            'efficiency_mult': efficiency_mult,
            'minutes_adjustment': -1.0 if is_b2b else 0.0, # Maybe play slightly less on B2B
        }
