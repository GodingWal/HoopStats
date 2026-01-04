"""
Main Projection Engine
Combines all sub-models to generate player prop projections
"""
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
from dataclasses import dataclass
from datetime import datetime, timedelta

from src.features.player_features import PlayerFeatureEngineer, PlayerFeatures
from src.features.matchup_features import MatchupFeatureEngineer
from src.features.situational import SituationalFactorEngineer
from src.models.minutes_model import MinutesModel
from src.models.usage_redistribution import UsageRedistributionModel
from src.models.stat_projections import StatProjectionModel
from src.models.distributions import (
    DistributionModeler, 
    StatProjection, 
    JointProjection,
    calculate_edge,
    kelly_criterion
)


@dataclass
class GameContext:
    """Context for a specific game"""
    opponent: str
    is_home: bool
    is_b2b: bool
    rest_days: int
    spread: float  # Positive = underdog
    total: float
    opponent_def_rating: float
    opponent_pace: float
    teammate_injuries: List[str]  # Names of injured teammates


@dataclass
class PropRecommendation:
    """Betting recommendation for a prop"""
    player_name: str
    stat: str
    line: float
    side: str  # "over" or "under"
    model_prob: float
    implied_prob: float
    edge: float
    expected_value: float
    kelly_bet: float
    confidence: str  # "high", "medium", "low"
    
    def __str__(self):
        return (
            f"{self.player_name} {self.stat} {self.side.upper()} {self.line} "
            f"| Edge: {self.edge:.1%} | EV: {self.expected_value:.1%} | "
            f"Conf: {self.confidence}"
        )


class ProjectionEngine:
    """
    Main engine for generating player prop projections
    """
    
    def __init__(
        self,
        min_edge_threshold: float = 0.03,
        kelly_fraction: float = 0.25,
        n_simulations: int = 10000
    ):
        self.min_edge_threshold = min_edge_threshold
        self.kelly_fraction = kelly_fraction
        
        # Sub-components
        self.feature_engineer = PlayerFeatureEngineer()
        self.matchup_engineer = MatchupFeatureEngineer()
        self.situational_engineer = SituationalFactorEngineer()
        
        self.minutes_model = MinutesModel()
        self.usage_model = UsageRedistributionModel()
        self.stat_model = StatProjectionModel()
        self.distribution_modeler = DistributionModeler(n_simulations=n_simulations)
        
        # Cache for opponent stats
        self._opponent_cache: Dict[str, Dict] = {}
        
    def project_player(
        self,
        game_log: pd.DataFrame,
        context: GameContext,
        career_stats: Optional[pd.DataFrame] = None
    ) -> JointProjection:
        """
        Generate full projection for a player
        
        Args:
            game_log: Player's game log (most recent first)
            context: Game context (opponent, situational factors)
            career_stats: Optional career stats for regression
        """
        # Step 1: Engineer features
        features = self.feature_engineer.engineer_features(game_log, career_stats)
        
        # Step 2: Get opponent stats and calculate adjustments
        opponent_stats = self._get_opponent_stats(context)
        
        # Situational Adjustments
        situational_adjustments = self.situational_engineer.get_situational_adjustments(
            is_home=context.is_home,
            is_b2b=context.is_b2b,
            rest_days=context.rest_days
        )
        
        # Matchup Adjustments
        # Note: MatchupFeatureEngineer needs to be updated to accept player position
        # For now, pass a default or use what logic exists. 
        # The new MatchupFeatureEngineer.calculate_matchup_adjustments takes (player_pos, opponent_stats)
        matchup_adjustments = self.matchup_engineer.calculate_matchup_adjustments(
            player_pos=features.position, 
            opponent_stats=opponent_stats
        )
        
        # Apply situational factors to the matchup adjustments (combine them)
        # Situational usually affects efficiency_mult global, matchup is per stat
        # We can merge them.
        eff_mult = situational_adjustments.get('efficiency_mult', 1.0)
        
        combined_adjustments = {}
        for k, v in matchup_adjustments.items():
            combined_adjustments[k] = v * eff_mult
            
        # Usage Redistribution
        redistribution = self.usage_model.calculate_redistribution(
            features.player_name, 
            context.teammate_injuries
        )
        
        # Merge all modifiers
        all_modifiers = {**combined_adjustments, **redistribution}

        # Step 3: Project minutes
        # Pass spread and injuries to minutes model
        minutes_mean, minutes_std = self.minutes_model.project_minutes(
            features=features,
            spread=context.spread,
            opp_pace_rank=15, # Placeholder
            teammate_injuries=context.teammate_injuries
        )
        
        # Step 4: Project each stat
        stat_projections = {}
        
        for stat in ['points', 'rebounds', 'assists', 'threes']:
            mean, std = self.stat_model.project_stat(
                stat_name=stat,
                features=features,
                minutes=minutes_mean,
                modifiers=all_modifiers
            )
            
            # Determine distribution type
            if stat == 'points':
                dist_type = "normal"
            else:
                dist_type = "poisson" if mean < 10 else "negbinom"
            
            stat_projections[stat] = StatProjection(
                stat_name=stat,
                mean=max(mean, 0),
                std=max(std, 0.5), # Minimum variance
                distribution=dist_type,
                params={"loc": mean, "scale": std}
            )
            
        # Add Steals/Blocks/Turnovers (using legacy or simple logic if not in new model)
        # New model had extensive if/else, here we can do a simple pass if needed
        # Or add to stat_model.project_stat default case
        
        # For safety, let's just add basic objects for STL/BLK/TOV using features directly
        # to ensure the joint model doesn't crash if it expects them
        for stat, rate in [('steals', features.stl_per_min), ('blocks', features.blk_per_min)]:
             mean = rate * minutes_mean * eff_mult
             stat_projections[stat] = StatProjection(stat, mean, mean**0.5, "poisson", {"loc": mean, "scale": mean**0.5})
             
        tov_mean = features.tov_rate * (features.fga_per_game if hasattr(features, 'fga_per_game') else 15) # Rough approx
        stat_projections['turnovers'] = StatProjection('turnovers', 2.5, 1.5, "normal", {"loc": 2.5, "scale": 1.5})


        # Step 5: Estimate correlation matrix from historical data
        if len(game_log) >= 10:
            corr_matrix = self.distribution_modeler.estimate_correlation_from_data(game_log)
        else:
            corr_matrix = self.distribution_modeler.DEFAULT_CORRELATIONS
        
        # Step 6: Create joint projection
        player_name = game_log['PLAYER_NAME'].iloc[0] if 'PLAYER_NAME' in game_log else "Unknown"
        game_date = datetime.now().strftime("%Y-%m-%d")
        
        return self.distribution_modeler.create_joint_projection(
            stat_projections=stat_projections,
            player_name=player_name,
            game_date=game_date,
            opponent=context.opponent,
            minutes_mean=minutes_mean,
            minutes_std=minutes_std,
            correlation_matrix=corr_matrix
        )
    
        base_projection = weighted_rate * minutes_mean * adjustment
        
        # Regression toward baseline (if available)
        if features.games_played < 20:
            # Regress toward career/league average
            baseline = self._get_stat_baseline(stat_name, features)
            base_projection = self.feature_engineer.regress_to_baseline(
                base_projection,
                baseline,
                features.games_played
            )
        
        # Fit distribution from historical if available
        if historical is not None and len(historical) >= 5:
            # Adjust historical values to current context
            historical_mean = np.nanmean(historical)
            if historical_mean > 0:
                scale_factor = base_projection / historical_mean
                adjusted_historical = historical * scale_factor
                return self.distribution_modeler.fit_stat_distribution(
                    adjusted_historical,
                    stat_name
                )
        
        # Fallback: create projection with estimated variance
        std = self._estimate_stat_std(stat_name, base_projection, features)
        
        # Determine distribution type
        if stat_name in ['points']:
            dist_type = "normal"
        else:
            dist_type = "poisson" if base_projection < 10 else "negbinom"
        
        return StatProjection(
            stat_name=stat_name,
            mean=max(base_projection, 0),
            std=max(std, 0.5),
            distribution=dist_type,
            params={"loc": base_projection, "scale": std}
        )
    
    def _get_stat_baseline(self, stat_name: str, features: PlayerFeatures) -> float:
        """Get baseline value for regression"""
        if stat_name == 'points' and features.career_ppg:
            return features.career_ppg
        elif stat_name == 'rebounds' and features.career_rpg:
            return features.career_rpg
        elif stat_name == 'assists' and features.career_apg:
            return features.career_apg
        
        # League average fallbacks
        league_avgs = {
            'points': 12.0,
            'rebounds': 5.0,
            'assists': 3.0,
            'threes': 1.5,
            'steals': 0.8,
            'blocks': 0.5,
            'turnovers': 1.5
        }
        return league_avgs.get(stat_name, 5.0)
    
    def _estimate_stat_std(
        self,
        stat_name: str,
        mean: float,
        features: PlayerFeatures
    ) -> float:
        """Estimate standard deviation for a stat"""
        # Coefficient of variation estimates by stat type
        cv_estimates = {
            'points': 0.30,
            'rebounds': 0.35,
            'assists': 0.40,
            'threes': 0.60,
            'steals': 0.70,
            'blocks': 0.80,
            'turnovers': 0.50
        }
        
        cv = cv_estimates.get(stat_name, 0.40)
        
        # Use actual variance if available
        if stat_name == 'points':
            actual_std = features.pts_std
        elif stat_name == 'rebounds':
            actual_std = features.reb_std
        elif stat_name == 'assists':
            actual_std = features.ast_std
        else:
            actual_std = mean * cv
        
        return max(actual_std, mean * cv * 0.5)
    
    def _get_opponent_stats(self, context: GameContext) -> Dict:
        """Get opponent defensive stats"""
        # In production, this would fetch from database
        # For now, use provided values + defaults
        return {
            'def_rating': context.opponent_def_rating,
            'pace': context.opponent_pace,
            'opp_reb_per_game': 44,  # Would be fetched
            'opp_ast_per_game': 25,
            'opp_3pt_pct': 0.36,
        }
    
    def evaluate_prop(
        self,
        projection: JointProjection,
        stat: str,
        line: float,
        odds: int = -110
    ) -> PropRecommendation:
        """
        Evaluate a specific prop bet
        
        Args:
            projection: Player's projection
            stat: Stat to evaluate (points, rebounds, etc.)
            line: Betting line
            odds: American odds (default -110)
        """
        # Get the relevant projection
        stat_proj = getattr(projection, stat, None)
        
        if stat_proj is None:
            raise ValueError(f"Unknown stat: {stat}")
        
        # Calculate probabilities
        prob_over = stat_proj.prob_over(line)
        prob_under = 1 - prob_over
        
        # Determine best side
        if prob_over > prob_under:
            side = "over"
            model_prob = prob_over
        else:
            side = "under"
            model_prob = prob_under
        
        # Calculate edge and EV
        edge, ev = calculate_edge(model_prob, odds)
        
        # Calculate Kelly bet
        kelly = kelly_criterion(edge, odds, self.kelly_fraction)
        
        # Determine confidence level
        if edge >= 0.08:
            confidence = "high"
        elif edge >= 0.05:
            confidence = "medium"
        elif edge >= self.min_edge_threshold:
            confidence = "low"
        else:
            confidence = "no_bet"
        
        # Implied probability
        if odds < 0:
            implied = abs(odds) / (abs(odds) + 100)
        else:
            implied = 100 / (odds + 100)
        
        return PropRecommendation(
            player_name=projection.player_name,
            stat=stat,
            line=line,
            side=side,
            model_prob=model_prob,
            implied_prob=implied,
            edge=edge,
            expected_value=ev,
            kelly_bet=kelly,
            confidence=confidence
        )
    
    def find_best_props(
        self,
        projection: JointProjection,
        available_lines: Dict[str, List[Tuple[float, int]]],  # stat -> [(line, odds), ...]
        top_n: int = 5
    ) -> List[PropRecommendation]:
        """
        Find the best prop bets from available lines
        
        Args:
            projection: Player's projection
            available_lines: Dict of stat -> list of (line, odds) tuples
            top_n: Number of top recommendations to return
        """
        recommendations = []
        
        for stat, lines in available_lines.items():
            for line, odds in lines:
                try:
                    rec = self.evaluate_prop(projection, stat, line, odds)
                    if rec.edge >= self.min_edge_threshold:
                        recommendations.append(rec)
                except Exception:
                    continue
        
        # Sort by edge
        recommendations.sort(key=lambda x: x.edge, reverse=True)
        
        return recommendations[:top_n]
    
    def evaluate_parlay(
        self,
        projection: JointProjection,
        legs: List[Tuple[str, float, str]],  # [(stat, line, side), ...]
        n_sims: int = 10000
    ) -> Dict:
        """
        Evaluate a parlay/combo bet
        
        Args:
            projection: Player's projection
            legs: List of (stat, line, side) tuples
            n_sims: Number of simulations
        """
        # Simulate outcomes
        sims = self.distribution_modeler.simulate_joint_outcomes(projection, n_sims)
        
        # Check each simulation
        hits = np.ones(n_sims, dtype=bool)
        
        for stat, line, side in legs:
            if stat in sims.columns:
                if side.lower() == "over":
                    hits &= (sims[stat] > line)
                else:
                    hits &= (sims[stat] < line)
        
        prob = hits.mean()
        
        # Calculate fair odds
        if prob > 0:
            fair_decimal_odds = 1 / prob
            if fair_decimal_odds >= 2:
                fair_american_odds = int((fair_decimal_odds - 1) * 100)
            else:
                fair_american_odds = int(-100 / (fair_decimal_odds - 1))
        else:
            fair_american_odds = 9999
        
        return {
            'probability': prob,
            'fair_odds': fair_american_odds,
            'legs': legs,
            'n_legs': len(legs),
            'simulations': n_sims
        }


def create_sample_context(
    opponent: str = "BOS",
    is_home: bool = True,
    is_b2b: bool = False
) -> GameContext:
    """Create a sample game context for testing"""
    return GameContext(
        opponent=opponent,
        is_home=is_home,
        is_b2b=is_b2b,
        rest_days=1 if not is_b2b else 0,
        spread=-3.5 if is_home else 3.5,
        total=225.5,
        opponent_def_rating=110.0,
        opponent_pace=100.0,
        teammate_injuries=[]
    )
