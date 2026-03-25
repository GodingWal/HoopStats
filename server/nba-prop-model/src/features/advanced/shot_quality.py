"""
Shot Quality Estimation Framework (qSQ)

Quantified Shot Quality estimates the expected value of a player's
shot attempts based on shot type, distance, and contextual factors.

Without tracking data, we estimate qSQ from box score patterns:
- Shot distribution (3PA rate, FTA rate, midrange proxy)
- Expected eFG% from shot profile
- Shot Quality Delta: actual eFG% minus expected eFG%
- Rebounding geometry estimation from OREB/DREB splits
- Potential assist estimation

When tracking data IS available (Second Spectrum/SportVU),
this module can ingest:
- Shot location coordinates
- Defender distance at release
- Touch time / dribbles before shot
- Closest defender identity
"""

from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd


class ShotQualityEngineer:
    """
    Estimate shot quality metrics from available data.

    Two modes:
    1. Box-score mode: Estimates qSQ from shot type distributions
    2. Tracking mode: Uses actual shot location/defender data (when available)
    """

    # Expected eFG% by shot type (league averages 2024-25)
    SHOT_TYPE_EFG = {
        "rim": 0.63,        # At-rim attempts (layups, dunks)
        "short_mid": 0.41,  # Short midrange (4-14 feet)
        "long_mid": 0.40,   # Long midrange (15-22 feet)
        "three": 0.53,      # Three-pointers (eFG = 1.5 * 3P%)
        "free_throw": 0.78, # Free throws (not exactly eFG but useful)
    }

    # Shot distribution by player archetype
    ARCHETYPE_SHOT_DIST = {
        "rim_runner": {"rim": 0.55, "short_mid": 0.15, "long_mid": 0.05, "three": 0.15, "ft": 0.10},
        "stretch_big": {"rim": 0.25, "short_mid": 0.10, "long_mid": 0.10, "three": 0.40, "ft": 0.15},
        "perimeter": {"rim": 0.20, "short_mid": 0.10, "long_mid": 0.15, "three": 0.40, "ft": 0.15},
        "midrange": {"rim": 0.25, "short_mid": 0.20, "long_mid": 0.25, "three": 0.15, "ft": 0.15},
        "slasher": {"rim": 0.40, "short_mid": 0.15, "long_mid": 0.10, "three": 0.15, "ft": 0.20},
        "balanced": {"rim": 0.30, "short_mid": 0.15, "long_mid": 0.15, "three": 0.25, "ft": 0.15},
    }

    def __init__(self):
        pass

    def compute_shot_quality_features(
        self,
        game_log: pd.DataFrame,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute shot quality features from game log and context.

        Args:
            game_log: Player's recent game log.
            context: Dict with tracking data (optional), shot charts, etc.

        Returns:
            Dict of feature name -> value.
        """
        features = {}

        df = self._prepare_log(game_log)

        # Shot distribution estimation
        features.update(self._shot_distribution_features(df))

        # Expected vs actual efficiency (qSQ delta)
        features.update(self._shot_quality_delta(df, context))

        # Shot profile classification
        features.update(self._shot_profile_features(df))

        # Rebounding geometry (from OREB/DREB patterns)
        features.update(self._rebounding_geometry(df))

        # Potential assists estimation
        features.update(self._potential_assists(df, context))

        # Tracking data features (if available)
        tracking_data = context.get("tracking_data", {})
        if tracking_data:
            features.update(self._tracking_features(tracking_data))

        return features

    # ------------------------------------------------------------------
    # Shot distribution
    # ------------------------------------------------------------------

    def _shot_distribution_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """Estimate shot distribution from box score patterns."""
        features = {}

        if len(df) < 3:
            return self._default_shot_dist()

        subset = df.head(10)
        fga = subset["FGA"].sum()
        fg3a = subset.get("FG3A", pd.Series([0])).sum()
        fta = subset.get("FTA", pd.Series([0])).sum()
        fgm = subset["FGM"].sum()
        fg3m = subset.get("FG3M", pd.Series([0])).sum()

        if fga == 0:
            return self._default_shot_dist()

        # Three-point attempt rate
        three_par = fg3a / fga
        features["three_point_rate"] = three_par

        # Free throw rate (aggressiveness / driving proxy)
        ftr = fta / fga
        features["free_throw_rate"] = ftr

        # Two-point attempt rate
        two_pa = fga - fg3a
        two_par = two_pa / fga
        features["two_point_rate"] = two_par

        # Estimated rim rate (correlated with FTR and 2P%)
        # High FTR + high 2P% = more rim attempts
        two_pct = (fgm - fg3m) / two_pa if two_pa > 0 else 0.0
        estimated_rim_rate = min(0.6, ftr * 0.8 + max(0, two_pct - 0.45) * 0.5)
        features["estimated_rim_rate"] = estimated_rim_rate

        # Estimated midrange rate (2PA minus estimated rim attempts)
        midrange_rate = max(0, two_par - estimated_rim_rate)
        features["estimated_midrange_rate"] = midrange_rate

        # Shot quality mix score (higher = better shot selection)
        # Rim + 3PT are efficient, midrange is not
        shot_quality_mix = (
            estimated_rim_rate * 1.0 +
            three_par * 0.9 +
            midrange_rate * 0.5 +
            ftr * 0.8
        )
        features["shot_quality_mix"] = shot_quality_mix

        return features

    # ------------------------------------------------------------------
    # Shot quality delta (actual vs expected)
    # ------------------------------------------------------------------

    def _shot_quality_delta(
        self, df: pd.DataFrame, context: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Shot Quality Delta: actual eFG% minus expected eFG%.

        Positive delta = shooting better than shot quality warrants (hot/lucky)
        Negative delta = shooting worse than expected (cold/unlucky, due for regression)
        """
        features = {}

        if len(df) < 5:
            features["qsq_delta_l5"] = 0.0
            features["qsq_delta_l10"] = 0.0
            features["qsq_expected_efg"] = 0.50
            features["qsq_actual_efg"] = 0.50
            features["qsq_regression_signal"] = 0.0
            return features

        for window, label in [(5, "l5"), (10, "l10")]:
            subset = df.head(window)
            fga = subset["FGA"].sum()
            fgm = subset["FGM"].sum()
            fg3m = subset.get("FG3M", pd.Series([0])).sum()
            fg3a = subset.get("FG3A", pd.Series([0])).sum()
            fta = subset.get("FTA", pd.Series([0])).sum()

            if fga == 0:
                features[f"qsq_delta_{label}"] = 0.0
                continue

            # Actual eFG%
            actual_efg = (fgm + 0.5 * fg3m) / fga

            # Expected eFG% from shot distribution
            three_par = fg3a / fga
            ftr = fta / fga
            two_pa = fga - fg3a
            two_pct = (fgm - fg3m) / two_pa if two_pa > 0 else 0.45
            rim_rate = min(0.6, ftr * 0.8 + max(0, two_pct - 0.45) * 0.5)
            mid_rate = max(0, (1 - three_par) - rim_rate)

            expected_efg = (
                rim_rate * self.SHOT_TYPE_EFG["rim"] +
                mid_rate * 0.5 * self.SHOT_TYPE_EFG["short_mid"] +
                mid_rate * 0.5 * self.SHOT_TYPE_EFG["long_mid"] +
                three_par * self.SHOT_TYPE_EFG["three"]
            )

            features[f"qsq_delta_{label}"] = actual_efg - expected_efg

        # Season-level expected eFG
        features["qsq_expected_efg"] = expected_efg if fga > 0 else 0.50
        features["qsq_actual_efg"] = actual_efg if fga > 0 else 0.50

        # Regression signal: if delta is large, player likely regresses
        # Positive delta (overperforming) = UNDER signal
        # Negative delta (underperforming) = OVER signal
        delta_l10 = features.get("qsq_delta_l10", 0.0)
        features["qsq_regression_signal"] = -delta_l10 * 0.5  # Mean reversion

        return features

    # ------------------------------------------------------------------
    # Shot profile classification
    # ------------------------------------------------------------------

    def _shot_profile_features(self, df: pd.DataFrame) -> Dict[str, float]:
        """Classify player's shot profile and measure archetype fit."""
        features = {}

        if len(df) < 5:
            features["shot_archetype_rim_runner"] = 0.0
            features["shot_archetype_perimeter"] = 0.0
            features["shot_archetype_slasher"] = 0.0
            features["shot_archetype_balanced"] = 0.0
            return features

        subset = df.head(10)
        fga = subset["FGA"].sum()
        fg3a = subset.get("FG3A", pd.Series([0])).sum()
        fta = subset.get("FTA", pd.Series([0])).sum()
        fgm = subset["FGM"].sum()
        fg3m = subset.get("FG3M", pd.Series([0])).sum()

        if fga == 0:
            features["shot_archetype_rim_runner"] = 0.0
            features["shot_archetype_perimeter"] = 0.0
            features["shot_archetype_slasher"] = 0.0
            features["shot_archetype_balanced"] = 0.0
            return features

        three_par = fg3a / fga
        ftr = fta / fga
        two_pa = fga - fg3a
        two_pct = (fgm - fg3m) / two_pa if two_pa > 0 else 0.45
        rim_rate = min(0.6, ftr * 0.8 + max(0, two_pct - 0.45) * 0.5)

        # Archetype scores (how well does player fit each archetype)
        features["shot_archetype_rim_runner"] = float(np.clip(rim_rate / 0.55, 0, 1))
        features["shot_archetype_perimeter"] = float(np.clip(three_par / 0.40, 0, 1))
        features["shot_archetype_slasher"] = float(np.clip(ftr / 0.30, 0, 1))
        features["shot_archetype_balanced"] = 1.0 - abs(three_par - 0.35) - abs(rim_rate - 0.30)
        features["shot_archetype_balanced"] = float(np.clip(features["shot_archetype_balanced"], 0, 1))

        return features

    # ------------------------------------------------------------------
    # Rebounding geometry
    # ------------------------------------------------------------------

    def _rebounding_geometry(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Estimate rebounding geometry from OREB/DREB patterns.

        Without tracking data, we estimate positioning from:
        - OREB% (offensive glass aggressiveness)
        - DREB% (defensive positioning)
        - Contested rebound ratio estimates
        """
        features = {}

        if len(df) < 3 or "OREB" not in df.columns:
            features["oreb_rate_per_min"] = 0.0
            features["dreb_rate_per_min"] = 0.0
            features["oreb_pct_of_total"] = 0.0
            features["reb_dominance"] = 0.0
            features["reb_consistency"] = 0.0
            return features

        subset = df.head(10)
        oreb = subset["OREB"].sum()
        dreb = subset.get("DREB", pd.Series([0])).sum()
        total_reb = subset["REB"].sum()
        minutes = subset["MIN"].sum()

        features["oreb_rate_per_min"] = oreb / minutes if minutes > 0 else 0.0
        features["dreb_rate_per_min"] = dreb / minutes if minutes > 0 else 0.0
        features["oreb_pct_of_total"] = oreb / total_reb if total_reb > 0 else 0.0

        # Rebounding dominance: per-minute rate vs position average
        reb_per_min = total_reb / minutes if minutes > 0 else 0.0
        features["reb_dominance"] = min(reb_per_min / 0.25, 2.0)  # 0.25 = avg starter

        # Rebounding consistency
        if len(subset) >= 5:
            reb_values = subset["REB"].values.astype(float)
            mean_reb = np.mean(reb_values)
            if mean_reb > 0:
                features["reb_consistency"] = 1.0 - min(np.std(reb_values) / mean_reb, 1.0)
            else:
                features["reb_consistency"] = 0.0
        else:
            features["reb_consistency"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Potential assists
    # ------------------------------------------------------------------

    def _potential_assists(
        self, df: pd.DataFrame, context: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Estimate potential assist opportunities from box score.

        Potential assists = actual assists + secondary assists + passes
        leading to FTs. Without tracking, we estimate from AST/TOV patterns.
        """
        features = {}

        if len(df) < 3:
            features["ast_opportunity_rate"] = 0.0
            features["ast_conversion_rate"] = 0.0
            features["playmaking_load"] = 0.0
            return features

        subset = df.head(10)
        ast = subset["AST"].sum()
        tov = subset.get("TOV", pd.Series([0])).sum()
        fga = subset["FGA"].sum()
        minutes = subset["MIN"].sum()

        # Assist opportunity rate (ast + tov = ball-handling events)
        total_playmaking = ast + tov
        features["ast_opportunity_rate"] = total_playmaking / minutes if minutes > 0 else 0.0

        # Assist conversion rate (what % of playmaking events become assists)
        features["ast_conversion_rate"] = ast / total_playmaking if total_playmaking > 0 else 0.0

        # Playmaking load: share of team playmaking
        team_ast = context.get("team_ast_per_game", 25.0)
        player_ast_per_game = ast / len(subset) if len(subset) > 0 else 0.0
        features["playmaking_load"] = player_ast_per_game / team_ast if team_ast > 0 else 0.0

        # Estimated potential assists (tracking proxy)
        # Typically 1.5-2x actual assists for playmakers
        features["estimated_potential_ast"] = player_ast_per_game * 1.7

        return features

    # ------------------------------------------------------------------
    # Tracking data features (when available)
    # ------------------------------------------------------------------

    def _tracking_features(self, tracking: Dict[str, Any]) -> Dict[str, float]:
        """
        Extract features from tracking/optical data.

        Expects tracking dict with keys from NBA.com tracking stats or
        Second Spectrum/SportVU data.
        """
        features = {}

        # Average defender distance at shot release
        features["avg_defender_distance"] = float(tracking.get("avg_defender_distance", 0.0))

        # Average touch time before shot
        features["avg_touch_time"] = float(tracking.get("avg_touch_time", 0.0))

        # Average dribbles before shot
        features["avg_dribbles_before_shot"] = float(tracking.get("avg_dribbles", 0.0))

        # Catch-and-shoot vs pull-up ratio
        catch_shoot = tracking.get("catch_shoot_fga", 0)
        pullup = tracking.get("pullup_fga", 0)
        total = catch_shoot + pullup
        features["catch_shoot_ratio"] = catch_shoot / total if total > 0 else 0.5

        # Contested vs open shot ratio
        contested = tracking.get("contested_fga", 0)
        open_shots = tracking.get("open_fga", 0)
        total_tracked = contested + open_shots
        features["contested_shot_ratio"] = contested / total_tracked if total_tracked > 0 else 0.5

        # Speed/distance metrics
        features["avg_speed"] = float(tracking.get("avg_speed", 0.0))
        features["dist_per_game"] = float(tracking.get("distance_miles", 0.0))

        # Paint touches
        features["paint_touches"] = float(tracking.get("paint_touches", 0.0))

        # Elbow touches (midrange creation)
        features["elbow_touches"] = float(tracking.get("elbow_touches", 0.0))

        return features

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _prepare_log(self, game_log: pd.DataFrame) -> pd.DataFrame:
        df = game_log.copy()
        numeric = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "MIN",
                    "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB"]
        for col in numeric:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        if "MIN" in df.columns:
            if df["MIN"].dtype == "object":
                df["MIN"] = df["MIN"].apply(
                    lambda x: float(str(x).split(":")[0]) + float(str(x).split(":")[1]) / 60
                    if isinstance(x, str) and ":" in x else float(x) if not pd.isna(x) else 0
                )
            df = df[df["MIN"] > 0]
        return df

    def _default_shot_dist(self) -> Dict[str, float]:
        return {
            "three_point_rate": 0.35,
            "free_throw_rate": 0.25,
            "two_point_rate": 0.65,
            "estimated_rim_rate": 0.30,
            "estimated_midrange_rate": 0.20,
            "shot_quality_mix": 0.70,
        }
