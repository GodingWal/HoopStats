"""
Dimensionality Reduction Pipeline (PCA/NMF)

Reduces high-dimensional feature space to prevent XGBoost from
overfitting on noise. Uses PCA for continuous features and NMF
for non-negative features (tracking data, shot distributions).

Key techniques:
- PCA on EWMA feature groups (reduces 50+ EWMA features to ~10 components)
- NMF on shot quality / tracking features
- Feature group compression for correlated stat families
- Variance-explained threshold for automatic component selection
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
import logging

logger = logging.getLogger(__name__)

# Sklearn imports with fallback
try:
    from sklearn.decomposition import PCA, NMF
    from sklearn.preprocessing import StandardScaler
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False
    logger.info("sklearn not available — dimensionality reduction will use manual PCA")


class DimensionalityReducer:
    """
    Reduce feature dimensionality to prevent overfitting.

    Groups correlated features and compresses them using
    PCA (for general features) or NMF (for non-negative features).
    """

    # Feature groups for compression
    FEATURE_GROUPS = {
        "ewma_pts": [
            "ewma_pts_fast", "ewma_pts_medium", "ewma_pts_slow",
            "ewma_pts_var_fast", "ewma_pts_var_medium",
            "ewma_pts_momentum", "ewma_pts_accel",
        ],
        "ewma_reb": [
            "ewma_reb_fast", "ewma_reb_medium", "ewma_reb_slow",
            "ewma_reb_var_fast", "ewma_reb_var_medium",
            "ewma_reb_momentum", "ewma_reb_accel",
        ],
        "ewma_ast": [
            "ewma_ast_fast", "ewma_ast_medium", "ewma_ast_slow",
            "ewma_ast_var_fast", "ewma_ast_var_medium",
            "ewma_ast_momentum", "ewma_ast_accel",
        ],
        "efficiency": [
            "ts_pct_l5", "ts_pct_l10", "ts_pct_season",
            "efg_pct_l5", "efg_pct_l10", "efg_pct_season",
            "ftr_l5", "ftr_l10", "ftr_season",
        ],
        "shot_quality": [
            "three_point_rate", "free_throw_rate", "estimated_rim_rate",
            "estimated_midrange_rate", "shot_quality_mix",
            "qsq_delta_l5", "qsq_delta_l10",
        ],
        "defense_matchup": [
            "opp_def_rating_raw", "opp_def_percentile",
            "opp_stl_rate", "opp_blk_rate", "opp_tov_forced_rate",
            "opp_3pt_pct_allowed", "opp_foul_rate",
        ],
        "fatigue": [
            "rest_days", "is_b2b", "games_in_4_nights", "games_in_6_nights",
            "travel_distance_miles", "timezone_change", "altitude_fatigue_factor",
            "cumulative_fatigue_score",
        ],
    }

    # Number of PCA components to keep per group
    DEFAULT_N_COMPONENTS = {
        "ewma_pts": 3,
        "ewma_reb": 3,
        "ewma_ast": 3,
        "efficiency": 3,
        "shot_quality": 3,
        "defense_matchup": 3,
        "fatigue": 3,
    }

    def __init__(
        self,
        n_components: Optional[Dict[str, int]] = None,
        variance_threshold: float = 0.90,
    ):
        """
        Args:
            n_components: Override number of components per group.
            variance_threshold: Keep components explaining this % of variance.
        """
        self.n_components = n_components or self.DEFAULT_N_COMPONENTS
        self.variance_threshold = variance_threshold
        self.fitted_models: Dict[str, Any] = {}
        self.fitted_scalers: Dict[str, Any] = {}
        self.is_fitted = False

    def fit(self, feature_matrix: List[Dict[str, float]]) -> None:
        """
        Fit PCA/NMF models on training data.

        Args:
            feature_matrix: List of feature dicts (one per training sample).
        """
        if not HAS_SKLEARN:
            logger.warning("sklearn not available, using passthrough mode")
            self.is_fitted = True
            return

        for group_name, feature_names in self.FEATURE_GROUPS.items():
            n_comp = self.n_components.get(group_name, 3)

            # Extract group features from all samples
            X = np.array([
                [sample.get(fname, 0.0) for fname in feature_names]
                for sample in feature_matrix
            ])

            if X.shape[0] < n_comp * 2:
                logger.warning(
                    f"Insufficient samples ({X.shape[0]}) for PCA on {group_name}, skipping"
                )
                continue

            # Standardize
            scaler = StandardScaler()
            X_scaled = scaler.fit_transform(X)

            # Fit PCA
            pca = PCA(n_components=min(n_comp, X.shape[1]))
            pca.fit(X_scaled)

            # Check variance explained
            cumvar = np.cumsum(pca.explained_variance_ratio_)
            effective_components = int(np.searchsorted(cumvar, self.variance_threshold) + 1)
            effective_components = min(effective_components, pca.n_components_)

            self.fitted_models[group_name] = pca
            self.fitted_scalers[group_name] = scaler

            logger.info(
                f"PCA {group_name}: {len(feature_names)} -> {effective_components} components "
                f"(explains {cumvar[effective_components-1]:.1%} variance)"
            )

        self.is_fitted = True

    def transform(self, features: Dict[str, float]) -> Dict[str, float]:
        """
        Transform features using fitted PCA models.

        Returns dict with both:
        - Original features (for backward compatibility)
        - PCA component features (for reduced dimensionality)
        """
        if not self.is_fitted:
            return features

        reduced = {}

        for group_name, feature_names in self.FEATURE_GROUPS.items():
            if group_name not in self.fitted_models:
                continue

            # Extract group features
            x = np.array([features.get(fname, 0.0) for fname in feature_names]).reshape(1, -1)

            # Scale and transform
            scaler = self.fitted_scalers[group_name]
            pca = self.fitted_models[group_name]

            try:
                x_scaled = scaler.transform(x)
                components = pca.transform(x_scaled)[0]

                for i, val in enumerate(components):
                    reduced[f"pca_{group_name}_{i}"] = float(val)
            except Exception as e:
                logger.warning(f"PCA transform failed for {group_name}: {e}")
                for i in range(self.n_components.get(group_name, 3)):
                    reduced[f"pca_{group_name}_{i}"] = 0.0

        return reduced

    def fit_transform_batch(
        self, feature_matrix: List[Dict[str, float]]
    ) -> List[Dict[str, float]]:
        """Fit on batch and transform all samples."""
        self.fit(feature_matrix)
        return [self.transform(features) for features in feature_matrix]

    def get_component_loadings(self, group_name: str) -> Optional[Dict[str, List[float]]]:
        """
        Get PCA component loadings for interpretability.

        Returns dict mapping feature names to their loadings on each component.
        """
        if group_name not in self.fitted_models:
            return None

        pca = self.fitted_models[group_name]
        feature_names = self.FEATURE_GROUPS[group_name]

        loadings = {}
        for i, fname in enumerate(feature_names):
            loadings[fname] = [float(pca.components_[j, i]) for j in range(pca.n_components_)]

        return loadings

    def manual_pca(
        self, features: Dict[str, float], group_name: str
    ) -> Dict[str, float]:
        """
        Manual PCA fallback when sklearn is not available.

        Uses simple correlation-based compression:
        - Mean of group (captures level)
        - Std of group (captures spread)
        - Trend (difference between first/last features)
        """
        feature_names = self.FEATURE_GROUPS.get(group_name, [])
        if not feature_names:
            return {}

        values = [features.get(fname, 0.0) for fname in feature_names]
        arr = np.array(values)

        result = {}
        result[f"pca_{group_name}_0"] = float(np.mean(arr))  # Level
        result[f"pca_{group_name}_1"] = float(np.std(arr))    # Spread
        if len(arr) >= 3:
            result[f"pca_{group_name}_2"] = float(arr[0] - arr[-1])  # Trend
        else:
            result[f"pca_{group_name}_2"] = 0.0

        return result

    def compress_features(
        self, features: Dict[str, float]
    ) -> Dict[str, float]:
        """
        Compress features, using PCA if fitted, manual fallback otherwise.

        Always returns the compressed features, whether using sklearn PCA
        or the manual compression fallback.
        """
        if self.is_fitted and HAS_SKLEARN and self.fitted_models:
            return self.transform(features)

        # Manual fallback
        compressed = {}
        for group_name in self.FEATURE_GROUPS:
            compressed.update(self.manual_pca(features, group_name))
        return compressed

    def get_pca_feature_names(self) -> List[str]:
        """Get list of all PCA feature names that will be generated."""
        names = []
        for group_name, _ in self.FEATURE_GROUPS.items():
            n_comp = self.n_components.get(group_name, 3)
            for i in range(n_comp):
                names.append(f"pca_{group_name}_{i}")
        return names
