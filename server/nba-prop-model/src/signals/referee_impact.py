from typing import Dict, Any, List, Optional
from .base import BaseSignal, SignalResult
import logging

logger = logging.getLogger(__name__)

class RefereeImpactSignal(BaseSignal):
    """
    Adjusts projections based on the foul-calling tendencies of the assigned referee crew.
    
    Logic:
    - High foul crews (> average) -> More free throws -> Boost Points
    - Low foul crews (< average) -> Fewer free throws -> Penalize Points
    """
    
    name = "referee_impact"
    description = "Adjusts for referee foul tendencies"
    stat_types = ["Points", "Pts+Rebs+Asts"]
    default_confidence = 0.6
    
    # League average fouls per game (approximate, should be dynamic ideally)
    LEAGUE_AVG_FOULS = 19.5
    
    # Thresholds
    HIGH_FOUL_THRESHOLD = 1.5  # Crew needs to be +1.5 fouls above avg
    LOW_FOUL_THRESHOLD = -1.5 # Crew needs to be -1.5 fouls below avg
    
    # Adjustment factor: points per extra foul called
    # 1 extra foul ~= 1.5 potential ft attempts * 78% ~= 1.2 points?
    # Conservative estimate: 0.5 points per extra foul deviation
    POINTS_PER_FOUL_DEV = 0.5

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """
        Calculate adjustment based on referee assignments.
        
        Requires 'game_referees' in context, which should be a list of dicts:
        [{'avg_fouls': 22.1}, {'avg_fouls': 19.2}, ...]
        """
        referees = context.get('game_referees') or []
        
        if not referees or len(referees) < 1:
            return self._create_neutral_result()
            
        # Calculate crew average fouls
        # Filter out refs with no data
        valid_refs = [r for r in referees if r.get('avg_fouls_per_game')]
        
        if not valid_refs:
            return self._create_neutral_result()
            
        crew_avg_fouls = sum(r['avg_fouls_per_game'] for r in valid_refs) / len(valid_refs)
        deviation = crew_avg_fouls - self.LEAGUE_AVG_FOULS
        
        # Calculate adjustment
        adjustment = 0.0
        direction = None
        confidence = 0.0
        fired = False
        
        if deviation > self.HIGH_FOUL_THRESHOLD:
            # High foul crew
            adjustment = deviation * self.POINTS_PER_FOUL_DEV
            direction = 'OVER'
            confidence = self.default_confidence
            fired = True
        elif deviation < self.LOW_FOUL_THRESHOLD:
            # Low foul crew
            adjustment = deviation * self.POINTS_PER_FOUL_DEV
            direction = 'UNDER'
            confidence = self.default_confidence
            fired = True
            
        # Cap adjustment
        adjustment = max(min(adjustment, 3.0), -3.0)
        
        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'crew_avg_fouls': round(crew_avg_fouls, 1),
                'deviation': round(deviation, 1),
                'ref_count': len(valid_refs)
            },
            sample_size=len(valid_refs) * 10 # heuristic
        )
