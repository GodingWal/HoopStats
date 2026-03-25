"""
XGBoost Model for NBA Prop Prediction

Wraps the XGBoost feature builder and provides training + inference.
Falls back to the existing SimpleGradientBoostedModel when xgboost
package is not installed, using the same expanded feature set.

Key advantages over the existing ensemble:
- Learns optimal thresholds from data (not hand-coded)
- Captures interaction effects (STAR_OUT + BAD_DEFENSE + HIGH_PACE = 3x, not additive)
- Non-linear relationships your scoring can't express
- Calibrated probabilities instead of scores

Usage:
    model = XGBoostPropModel()

    # Train (need 500+ labeled outcomes for reliable results)
    model.train(training_data, stat_type="Points")

    # Predict
    prob_over = model.predict_proba(context)
    hit = model.predict(context)
"""

import logging
import json
import os
import pickle
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import numpy as np

from src.features.xgboost_features import (
    XGBoostFeatureBuilder,
    XGBoostFeatureVector,
    XGBOOST_FEATURE_NAMES,
)

logger = logging.getLogger(__name__)

# Try to import xgboost; fall back to custom gradient boosting
try:
    import xgboost as xgb
    HAS_XGBOOST = True
    logger.info("xgboost package available — using native XGBoost")
except ImportError:
    HAS_XGBOOST = False
    logger.info("xgboost not installed — using fallback gradient boosting")

# Try to import sklearn calibration
try:
    from sklearn.calibration import IsotonicRegression
    HAS_SKLEARN_CALIBRATION = True
except ImportError:
    HAS_SKLEARN_CALIBRATION = False
    logger.info("sklearn not available — isotonic calibration disabled")


@dataclass
class XGBoostPrediction:
    """Output from XGBoost model."""
    prob_over: float
    prob_under: float
    predicted_hit: bool
    confidence: float
    feature_importances: Dict[str, float] = field(default_factory=dict)
    model_type: str = "xgboost"  # "xgboost" or "fallback_gbm"


class XGBoostPropModel:
    """
    XGBoost-based prop prediction model.

    Trains on labeled outcomes (features + hit/miss) and outputs
    calibrated probabilities for over/under the line.
    """

    # Minimum labeled outcomes needed before training is worthwhile
    MIN_TRAINING_SAMPLES = 100
    # Recommended for reliable results
    RECOMMENDED_TRAINING_SAMPLES = 500

    def __init__(
        self,
        n_estimators: int = 200,
        max_depth: int = 4,
        learning_rate: float = 0.05,
        min_child_weight: int = 5,
        subsample: float = 0.8,
        colsample_bytree: float = 0.8,
        reg_alpha: float = 0.1,
        reg_lambda: float = 1.0,
        model_dir: str = "models/xgboost",
        early_stopping_rounds: int = 20,
        use_calibration: bool = True,
        sample_weight_halflife_days: int = 90,
    ):
        self.params = {
            "n_estimators": n_estimators,
            "max_depth": max_depth,
            "learning_rate": learning_rate,
            "min_child_weight": min_child_weight,
            "subsample": subsample,
            "colsample_bytree": colsample_bytree,
            "reg_alpha": reg_alpha,
            "reg_lambda": reg_lambda,
        }
        self.model_dir = model_dir
        self.early_stopping_rounds = early_stopping_rounds
        self.use_calibration = use_calibration and HAS_SKLEARN_CALIBRATION
        self.sample_weight_halflife_days = sample_weight_halflife_days
        self.feature_builder = XGBoostFeatureBuilder()
        self.models: Dict[str, Any] = {}  # stat_type -> trained model
        self.calibrators: Dict[str, Any] = {}  # stat_type -> IsotonicRegression
        self.is_fitted: Dict[str, bool] = {}
        self.pruned_features: Dict[str, List[str]] = {}  # stat_type -> low-importance features

    def train(
        self,
        training_data: List[Dict[str, Any]],
        stat_type: str,
        validation_split: float = 0.2,
    ) -> Dict[str, Any]:
        """
        Train XGBoost model on labeled outcomes.

        Args:
            training_data: List of dicts with "features" and "target" keys.
                          Features is a dict of feature_name -> value.
                          Target is 1 (hit/over) or 0 (miss/under).
                          Optional "game_date" for recency weighting.
            stat_type: Stat type to train for (trains one model per stat).
            validation_split: Fraction held out for validation.

        Returns:
            Dict with training metrics (accuracy, AUC, feature importance).
        """
        if len(training_data) < self.MIN_TRAINING_SAMPLES:
            logger.warning(
                f"Only {len(training_data)} samples for {stat_type}. "
                f"Need {self.MIN_TRAINING_SAMPLES}+ for training, "
                f"{self.RECOMMENDED_TRAINING_SAMPLES}+ recommended."
            )
            if len(training_data) < 30:
                return {"error": "insufficient_data", "n_samples": len(training_data)}

        # Build feature matrix
        X, y = self._build_matrices(training_data)

        # Compute sample weights (recency bias)
        sample_weights = self._compute_sample_weights(training_data)

        # Train/val split (chronological — don't shuffle time series)
        split_idx = int(len(X) * (1 - validation_split))
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        w_train = sample_weights[:split_idx] if sample_weights is not None else None

        if HAS_XGBOOST:
            metrics = self._train_xgboost(X_train, y_train, X_val, y_val, stat_type, w_train)
        else:
            metrics = self._train_fallback(X_train, y_train, X_val, y_val, stat_type)

        # Post-hoc isotonic calibration
        if self.use_calibration and stat_type in self.models:
            self._fit_calibrator(X_val, y_val, stat_type)
            metrics["calibrated"] = True
        else:
            metrics["calibrated"] = False

        # Feature importance pruning — identify low-value features
        importances = metrics.get("feature_importances", {})
        if importances:
            total_imp = sum(importances.values())
            if total_imp > 0:
                self.pruned_features[stat_type] = [
                    name for name, imp in importances.items()
                    if imp / total_imp < 0.005  # < 0.5% importance
                ]
                metrics["pruned_features"] = self.pruned_features[stat_type]
                metrics["n_pruned"] = len(self.pruned_features[stat_type])

        self.is_fitted[stat_type] = True
        metrics["n_train"] = len(X_train)
        metrics["n_val"] = len(X_val)
        metrics["stat_type"] = stat_type

        logger.info(
            f"Trained {stat_type} model: "
            f"val_accuracy={metrics.get('val_accuracy', 0):.3f}, "
            f"n_train={metrics['n_train']}, n_val={metrics['n_val']}, "
            f"calibrated={metrics['calibrated']}"
        )

        return metrics

    def predict_proba(self, context: Dict[str, Any], stat_type: str) -> float:
        """
        Predict probability of hitting over the line.

        Uses isotonic calibration when available for better-calibrated outputs.

        Args:
            context: Game context dict.
            stat_type: Stat type.

        Returns:
            Probability of over (0.0 to 1.0).
        """
        if stat_type not in self.is_fitted or not self.is_fitted[stat_type]:
            return 0.5  # No model — return uninformative prior

        fv = self.feature_builder.build(context)
        X = fv.to_array().reshape(1, -1)

        model = self.models[stat_type]
        if HAS_XGBOOST and isinstance(model, xgb.XGBClassifier):
            proba = model.predict_proba(X)[0]
            raw_prob = float(proba[1])  # Probability of class 1 (hit)
        else:
            # Fallback model returns raw predictions, convert to probability
            raw = model.predict(X)[0]
            raw_prob = float(1.0 / (1.0 + np.exp(-raw)))

        # Apply isotonic calibration if available
        if stat_type in self.calibrators:
            try:
                calibrated = self.calibrators[stat_type].predict([raw_prob])
                return float(np.clip(calibrated[0], 0.01, 0.99))
            except Exception:
                pass

        return raw_prob

    def predict(self, context: Dict[str, Any], stat_type: str) -> XGBoostPrediction:
        """
        Full prediction with confidence and feature importances.

        Args:
            context: Game context dict.
            stat_type: Stat type.

        Returns:
            XGBoostPrediction with probabilities and metadata.
        """
        prob_over = self.predict_proba(context, stat_type)
        prob_under = 1.0 - prob_over

        # Get feature importances
        importances = self.get_feature_importance(stat_type)

        # Confidence: how far from 0.5
        confidence = abs(prob_over - 0.5) * 2.0  # 0.0 = coin flip, 1.0 = certain

        model_type = "xgboost" if (
            HAS_XGBOOST and stat_type in self.models
            and isinstance(self.models[stat_type], xgb.XGBClassifier)
        ) else "fallback_gbm"

        return XGBoostPrediction(
            prob_over=prob_over,
            prob_under=prob_under,
            predicted_hit=prob_over > 0.5,
            confidence=confidence,
            feature_importances=importances,
            model_type=model_type,
        )

    def get_feature_importance(self, stat_type: str) -> Dict[str, float]:
        """Get feature importance scores for a trained model."""
        if stat_type not in self.models:
            return {}

        model = self.models[stat_type]

        if HAS_XGBOOST and isinstance(model, xgb.XGBClassifier):
            importances = model.feature_importances_
            return dict(zip(XGBOOST_FEATURE_NAMES, importances))
        else:
            return model.get_feature_importance()

    def save(self, stat_type: str) -> bool:
        """Save trained model and calibrator to disk."""
        if stat_type not in self.models:
            return False

        os.makedirs(self.model_dir, exist_ok=True)
        path = os.path.join(self.model_dir, f"{stat_type}.json")

        model = self.models[stat_type]
        if HAS_XGBOOST and isinstance(model, xgb.XGBClassifier):
            model.save_model(path)
        else:
            # Serialize fallback model
            data = {
                "base_prediction": model.base_prediction,
                "stumps": model.stumps,
                "feature_names": model.feature_names,
            }
            with open(path, "w") as f:
                json.dump(data, f)

        # Save calibrator if available
        if stat_type in self.calibrators:
            cal_path = os.path.join(self.model_dir, f"{stat_type}_calibrator.pkl")
            try:
                with open(cal_path, "wb") as f:
                    pickle.dump(self.calibrators[stat_type], f)
                logger.info(f"Saved calibrator for {stat_type}")
            except Exception as e:
                logger.warning(f"Failed to save calibrator for {stat_type}: {e}")

        # Save pruned features list
        if stat_type in self.pruned_features:
            prune_path = os.path.join(self.model_dir, f"{stat_type}_pruned.json")
            with open(prune_path, "w") as f:
                json.dump(self.pruned_features[stat_type], f)

        logger.info(f"Saved {stat_type} model to {path}")
        return True

    def load(self, stat_type: str) -> bool:
        """Load a trained model, calibrator, and pruned features from disk."""
        path = os.path.join(self.model_dir, f"{stat_type}.json")
        if not os.path.exists(path):
            return False

        try:
            if HAS_XGBOOST:
                model = xgb.XGBClassifier()
                model.load_model(path)
                self.models[stat_type] = model
            else:
                with open(path) as f:
                    data = json.load(f)
                from src.models.ensemble import SimpleGradientBoostedModel
                model = SimpleGradientBoostedModel()
                model.base_prediction = data["base_prediction"]
                model.stumps = data["stumps"]
                model.feature_names = data["feature_names"]
                model.is_fitted = True
                self.models[stat_type] = model

            self.is_fitted[stat_type] = True

            # Load calibrator if available
            cal_path = os.path.join(self.model_dir, f"{stat_type}_calibrator.pkl")
            if os.path.exists(cal_path):
                try:
                    with open(cal_path, "rb") as f:
                        self.calibrators[stat_type] = pickle.load(f)
                    logger.info(f"Loaded calibrator for {stat_type}")
                except Exception:
                    pass

            # Load pruned features if available
            prune_path = os.path.join(self.model_dir, f"{stat_type}_pruned.json")
            if os.path.exists(prune_path):
                try:
                    with open(prune_path) as f:
                        self.pruned_features[stat_type] = json.load(f)
                except Exception:
                    pass

            logger.info(f"Loaded {stat_type} model from {path}")
            return True
        except Exception as e:
            logger.warning(f"Failed to load {stat_type} model: {e}")
            return False

    # ------------------------------------------------------------------
    # Private training methods
    # ------------------------------------------------------------------

    def _build_matrices(
        self, training_data: List[Dict[str, Any]]
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Convert training data to numpy arrays."""
        X_list = []
        y_list = []

        for row in training_data:
            features = row.get("features", {})
            target = row.get("target")
            if target is None:
                continue

            # Build feature array in canonical order
            x = np.array([
                float(features.get(name, 0.0))
                for name in XGBOOST_FEATURE_NAMES
            ])
            X_list.append(x)
            y_list.append(int(target))

        return np.array(X_list), np.array(y_list)

    def _compute_sample_weights(
        self, training_data: List[Dict[str, Any]]
    ) -> Optional[np.ndarray]:
        """Compute exponential decay sample weights based on game date recency.
        More recent games get higher weight. Half-life is configurable."""
        if self.sample_weight_halflife_days <= 0:
            return None

        today = datetime.utcnow()
        decay_rate = np.log(2) / self.sample_weight_halflife_days
        weights = []

        for row in training_data:
            target = row.get("target")
            if target is None:
                continue
            game_date = row.get("game_date")
            if game_date:
                try:
                    if isinstance(game_date, str):
                        gd = datetime.fromisoformat(game_date.replace("Z", "+00:00").split("+")[0])
                    else:
                        gd = game_date
                    days_ago = max((today - gd).days, 0)
                except (ValueError, TypeError):
                    days_ago = 90  # default to half-weight
            else:
                days_ago = 90
            weights.append(np.exp(-decay_rate * days_ago))

        if not weights:
            return None
        return np.array(weights)

    def _fit_calibrator(
        self, X_val: np.ndarray, y_val: np.ndarray, stat_type: str
    ) -> None:
        """Fit isotonic regression calibrator on validation predictions."""
        if not HAS_SKLEARN_CALIBRATION:
            return

        model = self.models[stat_type]
        if HAS_XGBOOST and isinstance(model, xgb.XGBClassifier):
            raw_proba = model.predict_proba(X_val)[:, 1]
        else:
            raw = model.predict(X_val)
            raw_proba = 1.0 / (1.0 + np.exp(-raw))

        if len(y_val) < 20:
            logger.warning(f"Too few validation samples ({len(y_val)}) for calibration")
            return

        calibrator = IsotonicRegression(y_min=0.01, y_max=0.99, out_of_bounds="clip")
        calibrator.fit(raw_proba, y_val)
        self.calibrators[stat_type] = calibrator

        # Log calibration improvement
        raw_brier = float(np.mean((raw_proba - y_val) ** 2))
        cal_proba = calibrator.predict(raw_proba)
        cal_brier = float(np.mean((cal_proba - y_val) ** 2))
        logger.info(
            f"Calibration for {stat_type}: Brier score {raw_brier:.4f} -> {cal_brier:.4f} "
            f"({'improved' if cal_brier < raw_brier else 'no improvement'})"
        )

    def _train_xgboost(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray,
        y_val: np.ndarray,
        stat_type: str,
        sample_weights: Optional[np.ndarray] = None,
    ) -> Dict[str, Any]:
        """Train using native XGBoost with early stopping and sample weights."""
        model = xgb.XGBClassifier(
            n_estimators=self.params["n_estimators"],
            max_depth=self.params["max_depth"],
            learning_rate=self.params["learning_rate"],
            min_child_weight=self.params["min_child_weight"],
            subsample=self.params["subsample"],
            colsample_bytree=self.params["colsample_bytree"],
            reg_alpha=self.params["reg_alpha"],
            reg_lambda=self.params["reg_lambda"],
            objective="binary:logistic",
            eval_metric="logloss",
            early_stopping_rounds=self.early_stopping_rounds,
            random_state=42,
        )

        model.fit(
            X_train, y_train,
            eval_set=[(X_val, y_val)],
            sample_weight=sample_weights,
            verbose=False,
        )

        self.models[stat_type] = model

        # Validation metrics
        val_preds = model.predict(X_val)
        val_proba = model.predict_proba(X_val)[:, 1]
        val_accuracy = float(np.mean(val_preds == y_val))

        # Log loss
        eps = 1e-7
        val_logloss = float(-np.mean(
            y_val * np.log(val_proba + eps) +
            (1 - y_val) * np.log(1 - val_proba + eps)
        ))

        # Brier score (calibration metric)
        val_brier = float(np.mean((val_proba - y_val) ** 2))

        # Feature importance
        importances = dict(zip(XGBOOST_FEATURE_NAMES, model.feature_importances_))
        top_features = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10]

        # Best iteration (from early stopping)
        best_iteration = getattr(model, "best_iteration", self.params["n_estimators"])

        return {
            "val_accuracy": val_accuracy,
            "val_logloss": val_logloss,
            "val_brier": val_brier,
            "best_iteration": best_iteration,
            "model_type": "xgboost",
            "top_features": top_features,
            "feature_importances": importances,
        }

    def _train_fallback(
        self,
        X_train: np.ndarray,
        y_train: np.ndarray,
        X_val: np.ndarray,
        y_val: np.ndarray,
        stat_type: str,
    ) -> Dict[str, Any]:
        """Train using fallback SimpleGradientBoostedModel."""
        from src.models.ensemble import SimpleGradientBoostedModel

        model = SimpleGradientBoostedModel(
            n_estimators=min(self.params["n_estimators"], 100),
            learning_rate=self.params["learning_rate"],
            max_depth=1,
        )

        # Convert classification to regression on log-odds
        y_train_logodds = np.where(y_train == 1, 1.0, -1.0)
        model.fit(X_train, y_train_logodds, feature_names=list(XGBOOST_FEATURE_NAMES))

        self.models[stat_type] = model

        # Validation metrics
        raw_preds = model.predict(X_val)
        val_proba = 1.0 / (1.0 + np.exp(-raw_preds))
        val_preds = (val_proba > 0.5).astype(int)
        val_accuracy = float(np.mean(val_preds == y_val))

        importances = model.get_feature_importance()
        top_features = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:10]

        return {
            "val_accuracy": val_accuracy,
            "model_type": "fallback_gbm",
            "top_features": top_features,
            "feature_importances": importances,
        }
