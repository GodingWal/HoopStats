"""
Confidence Calibration

Calibrates model probability outputs so that when the model says 60%,
the outcome actually occurs ~60% of the time.

Uses isotonic regression and Platt scaling to correct systematic
over/under-confidence in the model's probability estimates.
"""

from typing import Dict, List, Optional, Tuple
import numpy as np
from dataclasses import dataclass, field


@dataclass
class CalibrationMetrics:
    """Metrics for evaluating model calibration."""
    n_bins: int
    bin_edges: List[float]
    bin_true_probs: List[float]      # Actual hit rate per bin
    bin_predicted_probs: List[float]  # Average predicted prob per bin
    bin_counts: List[int]            # Number of predictions per bin
    brier_score: float               # Lower is better (0 = perfect)
    expected_calibration_error: float  # ECE - lower is better
    max_calibration_error: float      # MCE - worst bin


@dataclass
class CalibrationResult:
    """Result of applying calibration to a probability."""
    raw_probability: float
    calibrated_probability: float
    calibration_method: str
    adjustment: float  # calibrated - raw


class ConfidenceCalibrator:
    """
    Calibrates model probability outputs using historical performance.

    Two methods available:
    1. Platt Scaling: Logistic regression on raw probabilities
    2. Isotonic Regression: Non-parametric monotonic calibration

    Platt scaling is better for small samples; isotonic for larger ones.
    """

    # Minimum predictions needed to calibrate
    MIN_PREDICTIONS_PLATT = 50
    MIN_PREDICTIONS_ISOTONIC = 200

    # Default calibration bins
    N_BINS = 10

    def __init__(self):
        """Initialize calibrator."""
        # Platt scaling parameters per stat type
        self._platt_params: Dict[str, Tuple[float, float]] = {}
        # Isotonic regression lookup per stat type
        self._isotonic_maps: Dict[str, Dict[float, float]] = {}
        # Track predictions for online calibration
        self._prediction_history: Dict[str, List[Tuple[float, bool]]] = {}

    def fit_platt_scaling(
        self,
        predicted_probs: np.ndarray,
        actual_outcomes: np.ndarray,
        stat_type: str,
    ):
        """
        Fit Platt scaling (logistic regression on probabilities).

        Transforms: calibrated = sigmoid(a * logit(raw) + b)

        Args:
            predicted_probs: Array of model probabilities (0-1)
            actual_outcomes: Array of binary outcomes (0 or 1)
            stat_type: Stat type for this calibration
        """
        if len(predicted_probs) < self.MIN_PREDICTIONS_PLATT:
            return

        # Clip probabilities to avoid log(0)
        probs = np.clip(predicted_probs, 0.01, 0.99)

        # Convert to logit space
        logits = np.log(probs / (1 - probs))

        # Fit simple logistic regression: a * logit + b
        # Using Newton's method for 2 parameters
        a, b = self._fit_logistic(logits, actual_outcomes)

        self._platt_params[stat_type] = (a, b)

    def fit_isotonic_regression(
        self,
        predicted_probs: np.ndarray,
        actual_outcomes: np.ndarray,
        stat_type: str,
    ):
        """
        Fit isotonic regression for calibration.

        Creates a monotonically increasing mapping from
        predicted probabilities to calibrated probabilities.

        Args:
            predicted_probs: Array of model probabilities
            actual_outcomes: Array of binary outcomes
            stat_type: Stat type for this calibration
        """
        if len(predicted_probs) < self.MIN_PREDICTIONS_ISOTONIC:
            return

        # Sort by predicted probability
        sort_idx = np.argsort(predicted_probs)
        sorted_probs = predicted_probs[sort_idx]
        sorted_outcomes = actual_outcomes[sort_idx]

        # Pool-adjacent-violators algorithm (PAVA)
        calibrated = self._pool_adjacent_violators(sorted_outcomes)

        # Create lookup map (bin to calibrated probability)
        iso_map = {}
        n = len(sorted_probs)
        for i in range(0, n, max(1, n // 100)):
            raw = float(sorted_probs[i])
            cal = float(calibrated[i])
            iso_map[raw] = cal

        self._isotonic_maps[stat_type] = iso_map

    def calibrate(
        self,
        raw_probability: float,
        stat_type: str,
    ) -> CalibrationResult:
        """
        Calibrate a single probability using the best available method.

        Priority: Isotonic > Platt > Raw (no calibration)

        Args:
            raw_probability: Model's raw probability estimate
            stat_type: Stat type

        Returns:
            CalibrationResult with raw and calibrated probabilities
        """
        raw_probability = max(0.01, min(0.99, raw_probability))

        # Try isotonic first
        if stat_type in self._isotonic_maps:
            cal_prob = self._interpolate_isotonic(raw_probability, stat_type)
            return CalibrationResult(
                raw_probability=raw_probability,
                calibrated_probability=cal_prob,
                calibration_method='isotonic',
                adjustment=cal_prob - raw_probability,
            )

        # Try Platt scaling
        if stat_type in self._platt_params:
            cal_prob = self._apply_platt(raw_probability, stat_type)
            return CalibrationResult(
                raw_probability=raw_probability,
                calibrated_probability=cal_prob,
                calibration_method='platt',
                adjustment=cal_prob - raw_probability,
            )

        # No calibration available
        return CalibrationResult(
            raw_probability=raw_probability,
            calibrated_probability=raw_probability,
            calibration_method='none',
            adjustment=0.0,
        )

    def record_prediction(
        self,
        stat_type: str,
        predicted_prob: float,
        actual_hit: bool,
    ):
        """Record a prediction for online calibration tracking."""
        if stat_type not in self._prediction_history:
            self._prediction_history[stat_type] = []
        self._prediction_history[stat_type].append((predicted_prob, actual_hit))

        # Auto-refit when enough data accumulates
        history = self._prediction_history[stat_type]
        if len(history) % 100 == 0 and len(history) >= self.MIN_PREDICTIONS_PLATT:
            probs = np.array([h[0] for h in history])
            outcomes = np.array([1.0 if h[1] else 0.0 for h in history])
            self.fit_platt_scaling(probs, outcomes, stat_type)
            if len(history) >= self.MIN_PREDICTIONS_ISOTONIC:
                self.fit_isotonic_regression(probs, outcomes, stat_type)

    def evaluate_calibration(
        self,
        predicted_probs: np.ndarray,
        actual_outcomes: np.ndarray,
        n_bins: int = None,
    ) -> CalibrationMetrics:
        """
        Evaluate calibration quality.

        Args:
            predicted_probs: Array of predicted probabilities
            actual_outcomes: Array of binary outcomes
            n_bins: Number of calibration bins

        Returns:
            CalibrationMetrics with detailed breakdown
        """
        n_bins = n_bins or self.N_BINS
        bin_edges = np.linspace(0, 1, n_bins + 1)

        bin_true_probs = []
        bin_predicted_probs = []
        bin_counts = []

        for i in range(n_bins):
            mask = (predicted_probs >= bin_edges[i]) & (predicted_probs < bin_edges[i + 1])
            if mask.sum() == 0:
                bin_true_probs.append(0.0)
                bin_predicted_probs.append((bin_edges[i] + bin_edges[i + 1]) / 2)
                bin_counts.append(0)
                continue

            bin_true_probs.append(float(actual_outcomes[mask].mean()))
            bin_predicted_probs.append(float(predicted_probs[mask].mean()))
            bin_counts.append(int(mask.sum()))

        # Brier score
        brier = float(np.mean((predicted_probs - actual_outcomes) ** 2))

        # Expected Calibration Error
        total = len(predicted_probs)
        ece = 0.0
        mce = 0.0
        for i in range(n_bins):
            if bin_counts[i] > 0:
                gap = abs(bin_true_probs[i] - bin_predicted_probs[i])
                ece += (bin_counts[i] / total) * gap
                mce = max(mce, gap)

        return CalibrationMetrics(
            n_bins=n_bins,
            bin_edges=list(bin_edges),
            bin_true_probs=bin_true_probs,
            bin_predicted_probs=bin_predicted_probs,
            bin_counts=bin_counts,
            brier_score=brier,
            expected_calibration_error=ece,
            max_calibration_error=mce,
        )

    def _fit_logistic(
        self,
        logits: np.ndarray,
        outcomes: np.ndarray,
        max_iter: int = 100,
        lr: float = 0.01,
    ) -> Tuple[float, float]:
        """Fit logistic regression using gradient descent."""
        a = 1.0
        b = 0.0

        for _ in range(max_iter):
            z = a * logits + b
            preds = 1.0 / (1.0 + np.exp(-np.clip(z, -20, 20)))

            # Gradients
            error = preds - outcomes
            grad_a = np.mean(error * logits)
            grad_b = np.mean(error)

            a -= lr * grad_a
            b -= lr * grad_b

        return float(a), float(b)

    def _apply_platt(self, raw_prob: float, stat_type: str) -> float:
        """Apply Platt scaling to a probability."""
        a, b = self._platt_params[stat_type]

        # Convert to logit
        raw_prob = max(0.01, min(0.99, raw_prob))
        logit = np.log(raw_prob / (1 - raw_prob))

        # Apply transformation
        z = a * logit + b
        calibrated = 1.0 / (1.0 + np.exp(-np.clip(z, -20, 20)))

        return float(calibrated)

    def _interpolate_isotonic(self, raw_prob: float, stat_type: str) -> float:
        """Interpolate isotonic calibration map."""
        iso_map = self._isotonic_maps[stat_type]

        # Find nearest keys
        keys = sorted(iso_map.keys())
        if not keys:
            return raw_prob

        # Binary search for closest keys
        if raw_prob <= keys[0]:
            return iso_map[keys[0]]
        if raw_prob >= keys[-1]:
            return iso_map[keys[-1]]

        # Linear interpolation between nearest keys
        for i in range(len(keys) - 1):
            if keys[i] <= raw_prob <= keys[i + 1]:
                weight = (raw_prob - keys[i]) / (keys[i + 1] - keys[i]) if keys[i + 1] != keys[i] else 0.5
                return iso_map[keys[i]] * (1 - weight) + iso_map[keys[i + 1]] * weight

        return raw_prob

    def _pool_adjacent_violators(self, y: np.ndarray) -> np.ndarray:
        """Pool Adjacent Violators Algorithm for isotonic regression."""
        n = len(y)
        result = y.copy().astype(float)
        block_starts = list(range(n))
        block_sizes = [1] * n

        i = 0
        while i < n - 1:
            if result[i] > result[i + 1]:
                # Merge blocks
                total = result[i] * block_sizes[i] + result[i + 1] * block_sizes[i + 1]
                new_size = block_sizes[i] + block_sizes[i + 1]
                result[i] = total / new_size
                block_sizes[i] = new_size

                # Remove next block
                result = np.delete(result, i + 1)
                block_sizes.pop(i + 1)
                n -= 1

                # Check backward
                if i > 0:
                    i -= 1
            else:
                i += 1

        # Expand blocks back to original size
        expanded = np.zeros(len(y))
        idx = 0
        for val, size in zip(result, block_sizes):
            expanded[idx:idx + size] = val
            idx += size

        return expanded
