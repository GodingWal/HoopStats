"""
Model Stacking / Ensemble

Combines the analytical projection model with a simple ML model
to produce more robust predictions.

Ensembles almost always outperform individual models because they
capture different aspects of the signal.

Components:
1. Analytical model: The existing projection engine (feature-based)
2. Simple ML model: Gradient-boosted trees on engineered features
3. Blending: Weighted average of both model outputs
"""

from typing import Dict, List, Optional, Tuple, Any
import numpy as np
from dataclasses import dataclass, field


@dataclass
class EnsemblePrediction:
    """Output from ensemble model."""
    stat_type: str
    analytical_projection: float
    ml_projection: float
    ensemble_projection: float
    prob_over: float
    prob_under: float
    analytical_weight: float
    ml_weight: float
    confidence: float
    feature_importances: Dict[str, float] = field(default_factory=dict)


class SimpleGradientBoostedModel:
    """
    Simple gradient-boosted model for stat prediction.

    Uses decision stumps (1-level trees) with gradient boosting.
    This is a from-scratch implementation that doesn't require sklearn/xgboost,
    making it lightweight and dependency-free.

    Features used:
    - Season averages, L5, L10
    - Matchup factors (opponent defense, pace)
    - Situational (B2B, home/away)
    - Minutes projection
    - Signal outputs
    """

    def __init__(
        self,
        n_estimators: int = 50,
        learning_rate: float = 0.1,
        max_depth: int = 1,
    ):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.stumps: List[Dict] = []
        self.base_prediction: float = 0.0
        self.is_fitted: bool = False
        self.feature_names: List[str] = []

    def fit(self, X: np.ndarray, y: np.ndarray, feature_names: List[str] = None):
        """
        Fit the model using gradient boosting with decision stumps.

        Args:
            X: Feature matrix (n_samples, n_features)
            y: Target values (n_samples,)
            feature_names: Optional names for features
        """
        self.feature_names = feature_names or [f'f{i}' for i in range(X.shape[1])]
        self.base_prediction = np.mean(y)
        self.stumps = []

        # Initialize predictions
        predictions = np.full(len(y), self.base_prediction)

        for _ in range(self.n_estimators):
            # Calculate residuals
            residuals = y - predictions

            # Fit a decision stump to the residuals
            best_stump = self._fit_stump(X, residuals)
            if best_stump is None:
                break

            self.stumps.append(best_stump)

            # Update predictions
            stump_preds = self._predict_stump(X, best_stump)
            predictions += self.learning_rate * stump_preds

        self.is_fitted = True

    def predict(self, X: np.ndarray) -> np.ndarray:
        """Predict using the fitted ensemble."""
        if not self.is_fitted:
            return np.full(X.shape[0], self.base_prediction)

        predictions = np.full(X.shape[0], self.base_prediction)
        for stump in self.stumps:
            predictions += self.learning_rate * self._predict_stump(X, stump)

        return predictions

    def get_feature_importance(self) -> Dict[str, float]:
        """Get feature importance scores."""
        importances = np.zeros(len(self.feature_names))

        for stump in self.stumps:
            idx = stump['feature_idx']
            importances[idx] += abs(stump['improvement'])

        # Normalize
        total = importances.sum()
        if total > 0:
            importances /= total

        return dict(zip(self.feature_names, importances))

    def _fit_stump(
        self,
        X: np.ndarray,
        residuals: np.ndarray,
    ) -> Optional[Dict]:
        """Fit a single decision stump (1-level tree)."""
        n_samples, n_features = X.shape
        best_improvement = 0.0
        best_stump = None

        base_mse = np.mean(residuals ** 2)

        for feat_idx in range(n_features):
            feature_values = X[:, feat_idx]
            # Try median as split point (fast approximation)
            threshold = np.median(feature_values)

            left_mask = feature_values <= threshold
            right_mask = ~left_mask

            if left_mask.sum() < 2 or right_mask.sum() < 2:
                continue

            left_pred = np.mean(residuals[left_mask])
            right_pred = np.mean(residuals[right_mask])

            # Calculate improvement
            preds = np.where(left_mask, left_pred, right_pred)
            new_mse = np.mean((residuals - preds) ** 2)
            improvement = base_mse - new_mse

            if improvement > best_improvement:
                best_improvement = improvement
                best_stump = {
                    'feature_idx': feat_idx,
                    'threshold': threshold,
                    'left_value': left_pred,
                    'right_value': right_pred,
                    'improvement': improvement,
                }

        return best_stump

    def _predict_stump(self, X: np.ndarray, stump: Dict) -> np.ndarray:
        """Predict using a single stump."""
        feature_values = X[:, stump['feature_idx']]
        return np.where(
            feature_values <= stump['threshold'],
            stump['left_value'],
            stump['right_value'],
        )


class EnsembleProjector:
    """
    Ensemble projector combining analytical and ML models.
    """

    def __init__(
        self,
        analytical_weight: float = 0.65,
        ml_weight: float = 0.35,
    ):
        """
        Args:
            analytical_weight: Weight for analytical model output
            ml_weight: Weight for ML model output (should sum to 1.0 with analytical)
        """
        self.analytical_weight = analytical_weight
        self.ml_weight = ml_weight
        self.ml_models: Dict[str, SimpleGradientBoostedModel] = {}

    def build_feature_vector(self, context: Dict[str, Any]) -> Tuple[np.ndarray, List[str]]:
        """
        Build feature vector from context for ML model.

        Returns (feature_array, feature_names)
        """
        features = []
        names = []

        # Season averages
        season = context.get('season_averages', {})
        for stat in ['pts', 'reb', 'ast', 'fg3m']:
            features.append(season.get(stat, 0.0))
            names.append(f'season_{stat}')

        # L5 averages
        l5 = context.get('last_5_averages', {})
        for stat in ['pts', 'reb', 'ast', 'fg3m']:
            features.append(l5.get(stat, 0.0))
            names.append(f'l5_{stat}')

        # L10 averages
        l10 = context.get('last_10_averages', {})
        for stat in ['pts', 'reb', 'ast', 'fg3m']:
            features.append(l10.get(stat, 0.0))
            names.append(f'l10_{stat}')

        # Situational
        features.append(1.0 if context.get('is_b2b', False) else 0.0)
        names.append('is_b2b')

        features.append(1.0 if context.get('is_home', True) else 0.0)
        names.append('is_home')

        # Opponent
        features.append(context.get('opponent_pace', 100.0))
        names.append('opp_pace')

        features.append(context.get('opponent_def_rating', 110.0))
        names.append('opp_def_rating')

        features.append(abs(context.get('vegas_spread', 0.0)))
        names.append('abs_spread')

        features.append(context.get('vegas_total', 225.0))
        names.append('vegas_total')

        # Minutes projection
        features.append(context.get('projected_minutes', 30.0))
        names.append('proj_minutes')

        # Signal outputs (if available)
        signals = context.get('signal_adjustments', {})
        for signal_name in ['injury_alpha', 'b2b', 'pace', 'defense',
                            'blowout', 'home_away', 'recent_form',
                            'fatigue', 'referee', 'line_movement']:
            features.append(signals.get(signal_name, 0.0))
            names.append(f'signal_{signal_name}')

        return np.array(features).reshape(1, -1), names

    def train_ml_model(
        self,
        stat_type: str,
        training_data: List[Dict[str, Any]],
        actuals: List[float],
    ):
        """
        Train ML model for a specific stat type.

        Args:
            stat_type: Stat type to train for
            training_data: List of context dicts
            actuals: Corresponding actual stat values
        """
        if len(training_data) < 30:
            return  # Not enough data

        X_list = []
        feature_names = None
        for ctx in training_data:
            feat_vec, names = self.build_feature_vector(ctx)
            X_list.append(feat_vec.flatten())
            if feature_names is None:
                feature_names = names

        X = np.array(X_list)
        y = np.array(actuals)

        model = SimpleGradientBoostedModel(n_estimators=50, learning_rate=0.1)
        model.fit(X, y, feature_names)
        self.ml_models[stat_type] = model

    def predict(
        self,
        stat_type: str,
        analytical_projection: float,
        context: Dict[str, Any],
        line: Optional[float] = None,
    ) -> EnsemblePrediction:
        """
        Generate ensemble prediction.

        Args:
            stat_type: Stat type being predicted
            analytical_projection: Output from analytical model
            context: Full context dict
            line: Optional betting line

        Returns:
            EnsemblePrediction with blended output
        """
        # Get ML prediction
        ml_projection = analytical_projection  # Default to analytical if no ML model
        feature_importances = {}

        if stat_type in self.ml_models:
            model = self.ml_models[stat_type]
            X, _ = self.build_feature_vector(context)
            ml_projection = float(model.predict(X)[0])
            feature_importances = model.get_feature_importance()

        # Blend
        ensemble_projection = (
            self.analytical_weight * analytical_projection +
            self.ml_weight * ml_projection
        )

        # Calculate probabilities if line provided
        prob_over = 0.5
        prob_under = 0.5
        if line is not None:
            # Use ensemble projection and estimated std
            std = self._estimate_std(stat_type, context)
            if std > 0:
                from scipy.stats import norm
                prob_over = 1 - norm.cdf(line, ensemble_projection, std)
                prob_under = 1 - prob_over

        # Confidence based on model agreement
        if analytical_projection > 0:
            agreement = 1.0 - abs(analytical_projection - ml_projection) / analytical_projection
            confidence = max(0.3, min(agreement, 0.9))
        else:
            confidence = 0.5

        return EnsemblePrediction(
            stat_type=stat_type,
            analytical_projection=analytical_projection,
            ml_projection=ml_projection,
            ensemble_projection=ensemble_projection,
            prob_over=prob_over,
            prob_under=prob_under,
            analytical_weight=self.analytical_weight,
            ml_weight=self.ml_weight,
            confidence=confidence,
            feature_importances=feature_importances,
        )

    def _estimate_std(self, stat_type: str, context: Dict[str, Any]) -> float:
        """Estimate standard deviation for probability calculation."""
        cv_estimates = {
            'Points': 0.30, 'Rebounds': 0.35, 'Assists': 0.40,
            '3-Pointers Made': 0.60, 'Pts+Rebs+Asts': 0.25,
        }

        cv = cv_estimates.get(stat_type, 0.35)
        season = context.get('season_averages', {})
        stat_key = {'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
                    '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra'}.get(stat_type, 'pts')

        mean = season.get(stat_key, 15.0)
        return mean * cv
