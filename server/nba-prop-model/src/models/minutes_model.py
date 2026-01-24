
from typing import Tuple, List, Dict, Optional
import pandas as pd
import numpy as np
from ..features.player_features import PlayerFeatures


class MinutesModel:
    """
    Project player minutes based on historical data and game context.

    Minutes explain ~60-70% of stat variance, making this the highest-leverage model.
    Incorporates:
    - Back-to-back impact
    - Rest days adjustment
    - Blowout risk (using spread + total)
    - Foul trouble patterns
    - Teammate injuries (usage redistribution)
    """

    # Historical adjustment factors (calibrated from NBA data)
    B2B_ADJUSTMENT = -4.5          # Minutes lost on back-to-backs
    REST_3PLUS_ADJUSTMENT = 2.0    # Extra minutes with 3+ days rest
    BLOWOUT_MINUTES_LOST = -8.0    # Expected minutes lost in blowouts (starters sit)
    FOUL_TROUBLE_ADJUSTMENT = -2.0 # Players averaging 3.5+ fouls/game
    INJURY_REDISTRIBUTION = 0.15   # Multiplier for teammate missing minutes

    def __init__(self):
        """Initialize the minutes model"""
        # Injury impact cache (team -> missing player -> affected players)
        self._injury_impact_cache: Dict[str, Dict[str, Dict[str, float]]] = {}

    def project_minutes(
        self,
        features: PlayerFeatures,
        spread: float,
        is_b2b: bool = False,
        rest_days: int = 1,
        total: float = 225.0,
        teammate_injuries: Dict[str, float] = None,
        fouls_per_game: Optional[float] = None,
        opp_pace_rank: int = 15  # 1-30, 15 is avg (kept for backward compatibility)
    ) -> Tuple[float, float]:
        """
        Project minutes with comprehensive contextual adjustments

        Args:
            features: Player's statistical features
            spread: Vegas spread (positive = underdog, negative = favorite)
            is_b2b: True if playing on back-to-back nights
            rest_days: Number of days since last game
            total: Vegas total (for blowout risk estimation)
            teammate_injuries: Dict of injured teammate names mapped to their avg minutes
            fouls_per_game: Player's foul rate (if None, uses features)
            opp_pace_rank: Opponent pace rank (1=fastest, 30=slowest)

        Returns:
            Tuple of (mean_minutes, std_minutes)
        """
        # 1. Base Minutes Estimate (weighted recent performance)
        base_minutes = self._calculate_base_minutes(features)

        # 2. Initialize adjustment tracker
        adjustments = {}

        # 3. Back-to-Back Impact
        if is_b2b:
            adjustments['back_to_back'] = self.B2B_ADJUSTMENT

        # 4. Rest Days Adjustment
        if rest_days >= 3:
            adjustments['rest_3plus'] = self.REST_3PLUS_ADJUSTMENT

        # 5. Blowout Risk (most important for minutes)
        blowout_prob = self._estimate_blowout_probability(spread, total)
        adjustments['blowout_risk'] = blowout_prob * self.BLOWOUT_MINUTES_LOST

        # 6. Foul Trouble Pattern
        fpg = fouls_per_game if fouls_per_game is not None else self._estimate_fouls_per_game(features)
        if fpg > 3.5:
            adjustments['foul_trouble'] = self.FOUL_TROUBLE_ADJUSTMENT

        # 7. Teammate Injuries (minute redistribution)
        if teammate_injuries:
            missing_minutes = self._sum_missing_teammate_minutes(
                teammate_injuries,
                features.team
            )
            adjustments['teammate_injuries'] = missing_minutes * self.INJURY_REDISTRIBUTION

        # 8. Apply all adjustments
        total_adjustment = sum(adjustments.values())
        projected_minutes = base_minutes + total_adjustment

        # 9. Hard caps (can't exceed game length, can't be negative)
        projected_minutes = min(max(projected_minutes, 0.0), 48.0)

        # 10. Variance Estimation
        std_minutes = self._estimate_minutes_variance(
            features,
            blowout_prob,
            is_b2b
        )

        return projected_minutes, std_minutes

    def _calculate_base_minutes(self, features: PlayerFeatures) -> float:
        """
        Calculate base minutes using weighted recent performance

        Weights favor recent games for rotation changes
        """
        # Handle early season (few games played)
        if features.games_played < 5:
            # Heavy reliance on season average
            return features.minutes_season
        elif features.games_played < 15:
            # Blend season and recent
            return (
                0.5 * features.minutes_season +
                0.3 * features.minutes_l5 +
                0.2 * features.minutes_l10
            )
        else:
            # Favor recent games (rotation changes)
            return (
                0.35 * features.minutes_season +
                0.40 * features.minutes_l5 +
                0.25 * features.minutes_l10
            )

    def _estimate_blowout_probability(self, spread: float, total: float) -> float:
        """
        Estimate probability of blowout (>15 point final margin)

        Uses spread + total to estimate game flow
        A -12 spread ≈ 35% blowout probability
        """
        # Absolute spread magnitude
        abs_spread = abs(spread)

        # Thresholds (calibrated from historical NBA data)
        # spread >= 12: ~35% blowout
        # spread >= 8: ~20% blowout
        # spread >= 5: ~10% blowout
        # spread < 5: ~5% blowout

        if abs_spread >= 12:
            base_prob = 0.35
        elif abs_spread >= 8:
            base_prob = 0.20 + (abs_spread - 8) / 4 * 0.15
        elif abs_spread >= 5:
            base_prob = 0.10 + (abs_spread - 5) / 3 * 0.10
        else:
            base_prob = 0.05 + abs_spread / 5 * 0.05

        # Adjust for total (high totals = offensive firepower = more blowout potential)
        if total > 230:
            total_mult = 1.15
        elif total > 220:
            total_mult = 1.05
        elif total < 210:
            total_mult = 0.90
        else:
            total_mult = 1.0

        return min(base_prob * total_mult, 0.60)  # Cap at 60%

    def _estimate_fouls_per_game(self, features: PlayerFeatures) -> float:
        """
        Estimate fouls per game from features

        Rough approximation: usage and minutes correlate with fouls
        Big men foul more (inferred from rebounding rate)
        """
        # Base estimate from league averages by archetype
        base_fouls = 2.0  # League average starter

        # High-usage players foul more (drawing contact)
        if features.usage_rate > 25:
            base_fouls += 0.5

        # Big men foul more (rim protection, post defense)
        if features.reb_per_min > 0.30:
            base_fouls += 0.8

        # High minutes = more foul opportunities
        minutes_factor = features.minutes_season / 36.0

        return base_fouls * minutes_factor

    def _sum_missing_teammate_minutes(
        self,
        injured_teammates: Dict[str, float],
        team: str
    ) -> float:
        """
        Sum the minutes lost from injured teammates directly from the inputs
        """
        if not injured_teammates:
            return 0.0
            
        return sum(injured_teammates.values())

    def _estimate_minutes_variance(
        self,
        features: PlayerFeatures,
        blowout_prob: float,
        is_b2b: bool
    ) -> float:
        """
        Estimate standard deviation of minutes projection

        Higher variance in:
        - Blowout games (unpredictable rotation)
        - Back-to-backs (load management unpredictability)
        - Players with inconsistent rotations (bench players)
        """
        # Base variance from historical data
        hist_std = features.minutes_std if features.minutes_std > 0 else 3.5

        # Multipliers for uncertainty
        multipliers = []

        # Blowout uncertainty (huge variance in garbage time)
        if blowout_prob > 0.3:
            multipliers.append(1.0 + blowout_prob * 0.8)

        # B2B uncertainty (coaches unpredictable with rest)
        if is_b2b:
            multipliers.append(1.2)

        # Low-minute players have higher variance (rotation uncertainty)
        if features.minutes_season < 20:
            multipliers.append(1.3)

        # Combine multipliers
        total_mult = np.prod(multipliers) if multipliers else 1.0

        return hist_std * total_mult

    def set_injury_impact_cache(self, cache: Dict[str, Dict[str, Dict[str, float]]]):
        """
        Set the injury impact cache for usage redistribution

        Structure:
        {
            "MIL": {  # Team
                "Giannis Antetokounmpo": {  # Injured player
                    "Damian Lillard": 3.2,  # Minutes boost for teammate
                    "Khris Middleton": 2.8,
                    ...
                }
            }
        }
        """
        self._injury_impact_cache = cache
