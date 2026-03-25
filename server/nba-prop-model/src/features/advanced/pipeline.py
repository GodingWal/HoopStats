"""
Master Advanced Feature Pipeline Orchestrator

Hierarchical pipeline that fuses:
1. Play-by-play derived features (EWMA, streaks, rolling variance)
2. Tracking/optical data features (qSQ, shot quality)
3. Advanced contextual features (schedule, matchup, lineup)
4. Domain-specific interaction terms
5. PCA/NMF dimensionality reduction

Outputs a single flat feature dict ready for XGBoost ingestion.

Usage:
    pipeline = AdvancedFeaturePipeline()
    features = pipeline.engineer_features(game_log, context)

    # For training, fit dimensionality reduction first:
    pipeline.fit_dimensionality_reduction(training_feature_matrix)
    reduced = pipeline.engineer_features(game_log, context, reduce_dimensions=True)
"""

from typing import Dict, Any, List, Optional
import logging
import pandas as pd

from .ewma_features import EWMAFeatureEngineer
from .usage_efficiency import UsageEfficiencyEngineer
from .defensive_matchup import DefensiveMatchupEngineer
from .schedule_context import ScheduleContextEngineer
from .shot_quality import ShotQualityEngineer
from .lineup_rotation import LineupRotationEngineer
from .interaction_terms import InteractionTermEngineer
from .dimensionality import DimensionalityReducer

logger = logging.getLogger(__name__)


class AdvancedFeaturePipeline:
    """
    Master orchestrator for advanced feature engineering.

    Coordinates all feature engineering modules in the correct order
    (some modules depend on outputs of others) and produces a flat
    feature dict ready for model consumption.

    Pipeline execution order:
    1. EWMA rolling features (from game log)
    2. Usage & efficiency derivatives (from game log + context)
    3. Schedule & fatigue context (from context)
    4. Defensive matchup features (from context)
    5. Shot quality features (from game log + context)
    6. Lineup & rotation features (from game log + context)
    7. Interaction terms (from all above features + context)
    8. Dimensionality reduction (optional, from all features)
    """

    def __init__(
        self,
        enable_pca: bool = False,
        pca_variance_threshold: float = 0.90,
    ):
        """
        Args:
            enable_pca: Whether to apply PCA compression.
            pca_variance_threshold: Variance explained threshold for PCA.
        """
        self.ewma_engineer = EWMAFeatureEngineer()
        self.usage_engineer = UsageEfficiencyEngineer()
        self.defense_engineer = DefensiveMatchupEngineer()
        self.schedule_engineer = ScheduleContextEngineer()
        self.shot_quality_engineer = ShotQualityEngineer()
        self.lineup_engineer = LineupRotationEngineer()
        self.interaction_engineer = InteractionTermEngineer()
        self.dimensionality_reducer = DimensionalityReducer(
            variance_threshold=pca_variance_threshold
        )
        self.enable_pca = enable_pca

    def engineer_features(
        self,
        game_log: pd.DataFrame,
        context: Dict[str, Any],
        stat_type: str = "Points",
        reduce_dimensions: bool = False,
    ) -> Dict[str, float]:
        """
        Run the full advanced feature engineering pipeline.

        Args:
            game_log: Player's game log DataFrame (most recent first).
            context: Rich context dict with opponent info, injuries,
                    schedule data, tracking data, etc.
            stat_type: The stat being projected (Points, Rebounds, etc.).
            reduce_dimensions: Whether to apply PCA/NMF reduction.

        Returns:
            Flat dict of feature_name -> float value.
        """
        all_features: Dict[str, float] = {}

        # Map stat_type to column name for EWMA
        stat_col = self._stat_type_to_column(stat_type)

        # ----------------------------------------------------------
        # Stage 1: EWMA rolling features (game log only)
        # ----------------------------------------------------------
        try:
            ewma_features = self.ewma_engineer.compute_ewma_features(
                game_log, stat_type=stat_col
            )
            all_features.update(ewma_features)
        except Exception as e:
            logger.warning(f"EWMA feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 2: Usage & efficiency derivatives
        # ----------------------------------------------------------
        try:
            usage_features = self.usage_engineer.compute_usage_efficiency_features(
                game_log, context
            )
            all_features.update(usage_features)
        except Exception as e:
            logger.warning(f"Usage/efficiency feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 3: Schedule & fatigue context
        # ----------------------------------------------------------
        try:
            schedule_features = self.schedule_engineer.compute_schedule_features(context)
            all_features.update(schedule_features)
        except Exception as e:
            logger.warning(f"Schedule context feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 4: Defensive matchup features
        # ----------------------------------------------------------
        try:
            defense_features = self.defense_engineer.compute_defensive_matchup_features(
                context
            )
            all_features.update(defense_features)
        except Exception as e:
            logger.warning(f"Defensive matchup feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 5: Shot quality features
        # ----------------------------------------------------------
        try:
            shot_features = self.shot_quality_engineer.compute_shot_quality_features(
                game_log, context
            )
            all_features.update(shot_features)
        except Exception as e:
            logger.warning(f"Shot quality feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 6: Lineup & rotation features
        # ----------------------------------------------------------
        try:
            lineup_features = self.lineup_engineer.compute_lineup_features(
                game_log, context
            )
            all_features.update(lineup_features)
        except Exception as e:
            logger.warning(f"Lineup rotation feature engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 7: Interaction terms (depends on stages 1-6)
        # ----------------------------------------------------------
        try:
            interaction_features = self.interaction_engineer.compute_interaction_features(
                all_features, context
            )
            all_features.update(interaction_features)
        except Exception as e:
            logger.warning(f"Interaction term engineering failed: {e}")

        # ----------------------------------------------------------
        # Stage 8: Dimensionality reduction (optional)
        # ----------------------------------------------------------
        if reduce_dimensions and self.enable_pca:
            try:
                pca_features = self.dimensionality_reducer.compress_features(all_features)
                all_features.update(pca_features)
            except Exception as e:
                logger.warning(f"Dimensionality reduction failed: {e}")

        # Sanitize: ensure all values are finite floats
        all_features = self._sanitize_features(all_features)

        logger.debug(f"Advanced pipeline produced {len(all_features)} features")
        return all_features

    def fit_dimensionality_reduction(
        self, training_features: List[Dict[str, float]]
    ) -> None:
        """
        Fit PCA/NMF on training data for dimensionality reduction.

        Call this before using reduce_dimensions=True in engineer_features().

        Args:
            training_features: List of feature dicts from training samples.
        """
        self.dimensionality_reducer.fit(training_features)
        self.enable_pca = True
        logger.info("Dimensionality reduction fitted on training data")

    def get_feature_names(self, include_pca: bool = False) -> List[str]:
        """
        Get ordered list of all feature names this pipeline produces.

        Useful for building the XGBoost feature vector in canonical order.
        """
        # We'll collect names by running with empty/default data
        # Instead, define canonical feature name prefixes
        prefixes = [
            # EWMA features
            "ewma_", "streak_", "rolling_var_", "rolling_range_", "rolling_skew_",
            # Usage/efficiency
            "ts_pct_", "efg_pct_", "ftr_", "usg_rate_", "pts_per_min_", "three_par_",
            "ast_tov_ratio_", "ts_delta_", "usg_delta_", "efficiency_volume_",
            "projected_usg_", "usg_boost_", "total_missing_", "star_teammate_",
            "num_injured_", "projected_minutes_boost", "pace_adj_", "pts_per_poss",
            "ts_stability", "usg_stability", "scoring_floor_", "scoring_ceiling_",
            # Schedule/fatigue
            "games_in_", "is_3_in_4", "is_4_in_6", "is_5_in_7", "rest_",
            "is_b2b", "travel_", "timezone_", "is_west_", "is_east_",
            "cumulative_travel_", "game_altitude", "altitude_",
            "is_high_altitude", "rest_advantage", "both_b2b",
            "rested_vs_", "tired_vs_", "cumulative_fatigue_", "fatigue_stat_",
            # Defense matchup
            "opp_def_", "opp_stl_", "opp_blk_", "opp_tov_forced_",
            "opp_3pt_", "opp_foul_", "opp_pos_def_", "opp_pts_to_pos_",
            "opp_scheme_", "scheme_impact_", "matchup_difficulty",
            "stat_matchup_", "expected_game_pace_", "opp_pace_adj_",
            "expected_possessions", "opp_transition_",
            "vs_elite_", "vs_poor_", "defense_sensitivity", "vs_opp_",
            # Shot quality
            "three_point_rate", "free_throw_rate", "two_point_rate",
            "estimated_rim_", "estimated_midrange_", "shot_quality_mix",
            "qsq_", "shot_archetype_", "oreb_", "dreb_", "reb_dominance",
            "reb_consistency", "ast_opportunity_", "ast_conversion_",
            "playmaking_load", "estimated_potential_",
            "avg_defender_", "avg_touch_", "avg_dribbles_",
            "catch_shoot_", "contested_shot_", "avg_speed", "dist_per_",
            "paint_touches", "elbow_touches",
            # Lineup/rotation
            "projected_minutes", "minutes_confidence", "minutes_floor",
            "minutes_ceiling", "minutes_trend", "blowout_",
            "is_favorite", "competitive_game_", "rotation_stability",
            "minutes_cv", "dnp_risk", "minutes_trend_consistency",
            "with_teammate_", "num_key_teammates_", "replacement_quality",
            "team_off_rating_delta", "role_score", "is_starter",
            "minutes_share", "implied_team_total", "implied_game_pace",
            "high_total_game", "low_total_game", "expected_competitive_",
            # Interaction terms
            "ix_",
        ]

        # Return prefix list for documentation purposes
        return prefixes

    def get_advanced_feature_names_for_xgboost(self) -> List[str]:
        """
        Get the canonical list of advanced feature names for XGBoost integration.

        These are the features that should be appended to the existing
        XGBOOST_FEATURE_NAMES list.
        """
        return ADVANCED_XGBOOST_FEATURES

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _stat_type_to_column(stat_type: str) -> str:
        """Map stat type to game log column name."""
        mapping = {
            "Points": "PTS", "Rebounds": "REB", "Assists": "AST",
            "3-Pointers Made": "FG3M", "Steals": "STL", "Blocks": "BLK",
            "Turnovers": "TOV", "Pts+Rebs+Asts": "PTS",
            "Pts+Rebs": "PTS", "Pts+Asts": "PTS", "Rebs+Asts": "REB",
        }
        return mapping.get(stat_type, "PTS")

    @staticmethod
    def _sanitize_features(features: Dict[str, float]) -> Dict[str, float]:
        """Ensure all feature values are finite floats."""
        sanitized = {}
        for key, value in features.items():
            try:
                val = float(value)
                if not (-1e10 < val < 1e10):
                    val = 0.0
                import math
                if math.isnan(val) or math.isinf(val):
                    val = 0.0
                sanitized[key] = val
            except (TypeError, ValueError):
                sanitized[key] = 0.0
        return sanitized


# Canonical list of advanced features for XGBoost integration
# These get appended to the existing XGBOOST_FEATURE_NAMES
ADVANCED_XGBOOST_FEATURES = [
    # --- EWMA Rolling Features ---
    "ewma_pts_fast",
    "ewma_pts_medium",
    "ewma_pts_slow",
    "ewma_pts_momentum",
    "ewma_pts_var_fast",
    "ewma_reb_fast",
    "ewma_reb_medium",
    "ewma_reb_momentum",
    "ewma_ast_fast",
    "ewma_ast_medium",
    "ewma_ast_momentum",
    "ewma_min_fast",
    "ewma_min_medium",
    "ewma_pts_per_min",
    "ewma_reb_per_min",
    "ewma_ast_per_min",
    "rolling_var_5",
    "rolling_var_10",
    "rolling_skew_10",

    # --- Usage & Efficiency Derivatives ---
    "ts_pct_l5",
    "efg_pct_l5",
    "usg_rate_l5",
    "ts_delta_vs_career",
    "ts_delta_vs_season",
    "usg_delta_l5_vs_season",
    "efficiency_volume_tradeoff",
    "projected_usg_rate",
    "usg_boost_from_injuries",
    "star_teammate_out",
    "num_injured_teammates",
    "projected_minutes_boost",
    "pts_per_poss",
    "ts_stability",
    "usg_stability",
    "scoring_floor_pct",
    "scoring_ceiling_pct",

    # --- Schedule & Fatigue Context ---
    "games_in_4_nights",
    "games_in_7_nights",
    "is_3_in_4",
    "is_4_in_6",
    "rest_impact",
    "is_b2b_front",
    "travel_distance_miles",
    "travel_category",
    "timezone_change",
    "altitude_fatigue_factor",
    "rest_advantage",
    "rested_vs_tired",
    "tired_vs_rested",
    "cumulative_fatigue_score",
    "fatigue_stat_impact",

    # --- Defensive Matchup & Opponent Context ---
    "opp_def_rating_vs_avg",
    "opp_def_percentile",
    "opp_stl_rate",
    "opp_blk_rate",
    "opp_3pt_defense_vs_avg",
    "opp_foul_rate",
    "opp_pos_def_rank_norm",
    "opp_pts_to_pos_vs_avg",
    "opp_scheme_aggression",
    "opp_scheme_variance",
    "matchup_difficulty",
    "stat_matchup_multiplier",
    "expected_game_pace_factor",
    "opp_pace_adj_pts_allowed",
    "expected_possessions",
    "opp_transition_defense",
    "defense_sensitivity",
    "vs_opp_avg",
    "vs_opp_hit_rate",

    # --- Shot Quality (qSQ) ---
    "three_point_rate",
    "free_throw_rate",
    "estimated_rim_rate",
    "shot_quality_mix",
    "qsq_delta_l5",
    "qsq_delta_l10",
    "qsq_regression_signal",
    "shot_archetype_rim_runner",
    "shot_archetype_perimeter",
    "shot_archetype_slasher",
    "reb_dominance",
    "reb_consistency",
    "playmaking_load",

    # --- Lineup & Rotation Dynamics ---
    "projected_minutes",
    "minutes_confidence",
    "minutes_floor",
    "minutes_ceiling",
    "minutes_trend",
    "blowout_probability",
    "blowout_minutes_impact",
    "is_favorite",
    "competitive_game_prob",
    "rotation_stability",
    "minutes_cv",
    "dnp_risk",
    "role_score",
    "is_starter",
    "minutes_share",
    "implied_team_total",
    "implied_game_pace",

    # --- Interaction Terms (the secret sauce) ---
    "ix_high_usg_x_elite_def",
    "ix_high_usg_x_poor_def",
    "ix_usg_x_def_rating",
    "ix_high_usg_b2b_tough_matchup",
    "ix_fatigue_x_usg",
    "ix_b2b_x_high_minutes_load",
    "ix_age_x_fatigue",
    "ix_3in4_x_high_usg",
    "ix_home_x_easy_matchup",
    "ix_away_x_tough_matchup",
    "ix_away_x_high_altitude",
    "ix_pace_x_minutes",
    "ix_fast_pace_x_high_min",
    "ix_total_x_minutes_share",
    "ix_star_out_x_high_usg",
    "ix_star_out_x_starter",
    "ix_multi_injury_x_role",
    "ix_usg_boost_x_easy_matchup",
    "ix_hot_streak_x_easy_matchup",
    "ix_cold_streak_x_tough_matchup",
    "ix_regression_x_matchup",
    "ix_rim_player_x_rim_protect",
    "ix_three_heavy_x_3pt_def",
    "ix_slasher_x_aggressive_def",
    "ix_high_total_x_high_usg",
    "ix_close_game_x_starter",
    "ix_implied_production",

    # --- PCA Components (when enabled) ---
    "pca_ewma_pts_0",
    "pca_ewma_pts_1",
    "pca_ewma_pts_2",
    "pca_efficiency_0",
    "pca_efficiency_1",
    "pca_efficiency_2",
    "pca_defense_matchup_0",
    "pca_defense_matchup_1",
    "pca_defense_matchup_2",
    "pca_fatigue_0",
    "pca_fatigue_1",
    "pca_fatigue_2",
]
