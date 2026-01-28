"""
Weight Optimizer for Signal Blending

Learns optimal signal weights from historical accuracy data.
Uses Bayesian approach to combine prior beliefs (default weights)
with observed accuracy from backtesting.
"""

from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta
import logging
import json

logger = logging.getLogger(__name__)


@dataclass
class SignalWeight:
    """Weight and metadata for a single signal."""
    signal_name: str
    weight: float
    accuracy: float
    sample_size: int
    prior_weight: float
    confidence_interval: tuple = (0.0, 1.0)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'weight': self.weight,
            'accuracy': self.accuracy,
            'sample_size': self.sample_size,
            'prior_weight': self.prior_weight,
            'confidence_interval': list(self.confidence_interval),
        }


@dataclass
class LearnedWeights:
    """Complete set of learned weights for a stat type."""
    stat_type: str
    weights: Dict[str, SignalWeight]
    overall_accuracy: float
    sample_size: int
    validation_window_days: int
    calculated_at: str
    method: str = 'bayesian'

    def get_weight(self, signal_name: str) -> float:
        """Get weight for a signal, returns 0 if not found."""
        if signal_name in self.weights:
            return self.weights[signal_name].weight
        return 0.0

    def to_weight_dict(self) -> Dict[str, float]:
        """Get simple weight dictionary for use in projection."""
        return {name: sw.weight for name, sw in self.weights.items()}

    def to_dict(self) -> Dict[str, Any]:
        return {
            'stat_type': self.stat_type,
            'weights': {name: sw.to_dict() for name, sw in self.weights.items()},
            'overall_accuracy': self.overall_accuracy,
            'sample_size': self.sample_size,
            'validation_window_days': self.validation_window_days,
            'calculated_at': self.calculated_at,
            'method': self.method,
        }

    def summary(self) -> str:
        """Generate summary string."""
        lines = [
            f"\nLEARNED WEIGHTS - {self.stat_type}",
            "=" * 50,
            f"Method: {self.method}",
            f"Validation Window: {self.validation_window_days} days",
            f"Sample Size: {self.sample_size}",
            f"Overall Accuracy: {self.overall_accuracy:.1%}",
            "-" * 50,
            f"{'Signal':<18} {'Weight':>8} {'Accuracy':>10} {'N':>6}",
            "-" * 50,
        ]

        # Sort by weight descending
        sorted_weights = sorted(
            self.weights.values(),
            key=lambda x: x.weight,
            reverse=True
        )

        for sw in sorted_weights:
            lines.append(
                f"{sw.signal_name:<18} {sw.weight:>8.3f} "
                f"{sw.accuracy*100:>9.1f}% {sw.sample_size:>6}"
            )

        lines.append("=" * 50)
        return "\n".join(lines)


class WeightOptimizer:
    """
    Learns optimal signal weights from historical accuracy.

    Methods:
    - simple: weight = (accuracy - 0.50) / sum(all edges)
    - bayesian: combine prior (defaults) with observed accuracy
      - More data → trust observed more
      - Less data → fall back to prior
    """

    # Default prior weights (should match signals/__init__.py)
    DEFAULT_PRIORS = {
        "injury_alpha": 0.20,
        "b2b": 0.15,
        "pace": 0.12,
        "defense": 0.12,
        "blowout": 0.12,
        "home_away": 0.08,
        "recent_form": 0.06,
    }

    # Prior strength (equivalent sample size)
    PRIOR_STRENGTH = 30

    # Minimum accuracy to receive any weight
    MIN_ACCURACY_THRESHOLD = 0.50

    def __init__(self, db_connection=None):
        """
        Initialize weight optimizer.

        Args:
            db_connection: Optional database connection
        """
        self.db_connection = db_connection

    def calculate_weights(
        self,
        stat_type: str,
        days: int = 60,
        method: str = 'bayesian',
        performance_data: Dict[str, Dict] = None,
    ) -> LearnedWeights:
        """
        Calculate optimal weights for a stat type.

        Args:
            stat_type: Stat type to optimize ('Points', 'Rebounds', 'Assists')
            days: Days of historical data to use
            method: 'simple' or 'bayesian'
            performance_data: Optional pre-loaded performance data

        Returns:
            LearnedWeights with optimized signal weights
        """
        # Load performance data
        if performance_data is None:
            performance_data = self._load_performance_data(stat_type, days)

        if not performance_data:
            logger.warning(f"No performance data for {stat_type} - using priors")
            return self._use_priors_only(stat_type, days)

        # Calculate weights based on method
        if method == 'simple':
            weights = self._simple_weights(performance_data)
        else:
            weights = self._bayesian_weights(performance_data, stat_type)

        # Normalize weights to sum to 1
        weights = self._normalize_weights(weights)

        # Calculate overall metrics
        total_correct = sum(
            d.get('correct_predictions', 0)
            for d in performance_data.values()
        )
        total_preds = sum(
            d.get('total_predictions', 0)
            for d in performance_data.values()
        )
        overall_accuracy = total_correct / total_preds if total_preds > 0 else 0.0

        return LearnedWeights(
            stat_type=stat_type,
            weights=weights,
            overall_accuracy=overall_accuracy,
            sample_size=total_preds,
            validation_window_days=days,
            calculated_at=datetime.now().isoformat(),
            method=method,
        )

    def _simple_weights(
        self,
        performance_data: Dict[str, Dict]
    ) -> Dict[str, SignalWeight]:
        """
        Simple weighting: weight = (accuracy - 0.50) / sum(all edges)

        Signals below 50% accuracy get 0 weight.
        """
        weights = {}

        # Calculate edge (accuracy above baseline) for each signal
        edges = {}
        for signal_name, data in performance_data.items():
            accuracy = data.get('accuracy', 0.5)
            edge = max(0, accuracy - 0.50)
            edges[signal_name] = edge

        # Sum of all edges for normalization
        total_edge = sum(edges.values())

        for signal_name, data in performance_data.items():
            accuracy = data.get('accuracy', 0.5)
            sample_size = data.get('total_predictions', 0)

            if total_edge > 0:
                weight = edges[signal_name] / total_edge
            else:
                weight = 0.0

            weights[signal_name] = SignalWeight(
                signal_name=signal_name,
                weight=weight,
                accuracy=accuracy,
                sample_size=sample_size,
                prior_weight=self.DEFAULT_PRIORS.get(signal_name, 0.10),
            )

        return weights

    def _bayesian_weights(
        self,
        performance_data: Dict[str, Dict],
        stat_type: str
    ) -> Dict[str, SignalWeight]:
        """
        Bayesian weighting: combine prior with observed accuracy.

        posterior = (prior × prior_n + observed × observed_n) / (prior_n + observed_n)
        weight = max(0, posterior - 0.50) / sum(all posterior edges)

        More data → trust observed more.
        Less data → fall back to prior.
        """
        weights = {}
        posterior_edges = {}

        for signal_name, data in performance_data.items():
            observed_accuracy = data.get('accuracy', 0.5)
            observed_n = data.get('total_predictions', 0)

            # Prior accuracy: assume prior weight reflects expected edge
            prior_weight = self.DEFAULT_PRIORS.get(signal_name, 0.10)
            # Convert prior weight to implied accuracy (inverse of simple method)
            prior_accuracy = 0.50 + prior_weight * 0.20  # Assuming 20% total edge spread

            # Bayesian update
            prior_n = self.PRIOR_STRENGTH
            total_n = prior_n + observed_n

            if total_n > 0:
                posterior_accuracy = (
                    (prior_accuracy * prior_n + observed_accuracy * observed_n)
                    / total_n
                )
            else:
                posterior_accuracy = prior_accuracy

            # Edge is accuracy above baseline
            posterior_edge = max(0, posterior_accuracy - 0.50)
            posterior_edges[signal_name] = posterior_edge

            weights[signal_name] = SignalWeight(
                signal_name=signal_name,
                weight=0.0,  # Will be set after normalization
                accuracy=observed_accuracy,
                sample_size=observed_n,
                prior_weight=prior_weight,
                confidence_interval=self._calculate_ci(observed_accuracy, observed_n),
            )

        # Normalize edges to weights
        total_edge = sum(posterior_edges.values())

        for signal_name in weights:
            if total_edge > 0:
                weights[signal_name].weight = posterior_edges[signal_name] / total_edge
            else:
                weights[signal_name].weight = self.DEFAULT_PRIORS.get(signal_name, 0.10)

        return weights

    def _normalize_weights(
        self,
        weights: Dict[str, SignalWeight]
    ) -> Dict[str, SignalWeight]:
        """Ensure weights sum to 1.0."""
        total = sum(sw.weight for sw in weights.values())

        if total > 0:
            for sw in weights.values():
                sw.weight = sw.weight / total

        return weights

    def _calculate_ci(
        self,
        accuracy: float,
        n: int,
        confidence: float = 0.95
    ) -> tuple:
        """Calculate confidence interval for accuracy using Wilson score."""
        if n == 0:
            return (0.0, 1.0)

        import math

        # Wilson score interval
        z = 1.96 if confidence == 0.95 else 2.576  # 95% or 99%

        p = accuracy
        denominator = 1 + z**2 / n

        center = (p + z**2 / (2*n)) / denominator
        spread = z * math.sqrt((p*(1-p) + z**2/(4*n)) / n) / denominator

        lower = max(0, center - spread)
        upper = min(1, center + spread)

        return (lower, upper)

    def _use_priors_only(self, stat_type: str, days: int) -> LearnedWeights:
        """Return weights based only on priors (no observed data)."""
        weights = {}

        for signal_name, prior_weight in self.DEFAULT_PRIORS.items():
            weights[signal_name] = SignalWeight(
                signal_name=signal_name,
                weight=prior_weight,
                accuracy=0.5,  # No observed data
                sample_size=0,
                prior_weight=prior_weight,
            )

        return LearnedWeights(
            stat_type=stat_type,
            weights=weights,
            overall_accuracy=0.5,
            sample_size=0,
            validation_window_days=days,
            calculated_at=datetime.now().isoformat(),
            method='prior_only',
        )

    def _load_performance_data(
        self,
        stat_type: str,
        days: int
    ) -> Dict[str, Dict]:
        """Load signal performance data from database."""
        if self.db_connection is None:
            return {}

        end_date = datetime.now() - timedelta(days=1)
        start_date = end_date - timedelta(days=days)

        query = """
            SELECT
                signal_name,
                SUM(predictions_made) as total_predictions,
                SUM(correct_predictions) as correct_predictions,
                AVG(accuracy) as avg_accuracy
            FROM signal_performance
            WHERE stat_type = %s
              AND evaluation_date >= %s
              AND evaluation_date <= %s
            GROUP BY signal_name
        """

        try:
            cursor = self.db_connection.cursor()
            cursor.execute(query, (
                stat_type,
                start_date.strftime('%Y-%m-%d'),
                end_date.strftime('%Y-%m-%d'),
            ))

            result = {}
            for row in cursor.fetchall():
                signal_name = row[0]
                total = row[1] or 0
                correct = row[2] or 0
                accuracy = correct / total if total > 0 else 0.5

                result[signal_name] = {
                    'total_predictions': total,
                    'correct_predictions': correct,
                    'accuracy': accuracy,
                }

            cursor.close()
            return result

        except Exception as e:
            logger.error(f"Error loading performance data: {e}")
            return {}

    def save_weights(self, weights: LearnedWeights) -> bool:
        """
        Save learned weights to database.

        1. Set valid_until = today on previous weights
        2. Insert new weights with valid_from = today
        """
        if self.db_connection is None:
            logger.warning("No database connection - cannot save weights")
            return False

        try:
            cursor = self.db_connection.cursor()
            today = datetime.now().strftime('%Y-%m-%d')

            # Expire previous weights
            cursor.execute("""
                UPDATE signal_weights
                SET valid_until = %s
                WHERE stat_type = %s AND valid_until IS NULL
            """, (today, weights.stat_type))

            # Insert new weights
            cursor.execute("""
                INSERT INTO signal_weights (
                    stat_type, weights, overall_accuracy,
                    sample_size, validation_window_days,
                    prior_strength, calculated_at, valid_from
                ) VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s)
            """, (
                weights.stat_type,
                json.dumps(weights.to_dict()['weights']),
                weights.overall_accuracy,
                weights.sample_size,
                weights.validation_window_days,
                self.PRIOR_STRENGTH,
                today,
            ))

            self.db_connection.commit()
            cursor.close()
            return True

        except Exception as e:
            logger.error(f"Error saving weights: {e}")
            self.db_connection.rollback()
            return False

    def load_current_weights(self, stat_type: str) -> Optional[LearnedWeights]:
        """
        Load current active weights from database.

        Returns weights where valid_until IS NULL.
        """
        if self.db_connection is None:
            return None

        query = """
            SELECT
                weights, overall_accuracy, sample_size,
                validation_window_days, calculated_at
            FROM signal_weights
            WHERE stat_type = %s AND valid_until IS NULL
            ORDER BY valid_from DESC
            LIMIT 1
        """

        try:
            cursor = self.db_connection.cursor()
            cursor.execute(query, (stat_type,))
            row = cursor.fetchone()
            cursor.close()

            if row is None:
                return None

            weights_data = row[0]
            if isinstance(weights_data, str):
                weights_data = json.loads(weights_data)

            # Reconstruct SignalWeight objects
            signal_weights = {}
            for name, data in weights_data.items():
                signal_weights[name] = SignalWeight(
                    signal_name=name,
                    weight=data.get('weight', 0.0),
                    accuracy=data.get('accuracy', 0.5),
                    sample_size=data.get('sample_size', 0),
                    prior_weight=data.get('prior_weight', 0.1),
                )

            return LearnedWeights(
                stat_type=stat_type,
                weights=signal_weights,
                overall_accuracy=row[1] or 0.5,
                sample_size=row[2] or 0,
                validation_window_days=row[3] or 60,
                calculated_at=str(row[4]) if row[4] else datetime.now().isoformat(),
            )

        except Exception as e:
            logger.error(f"Error loading weights: {e}")
            return None


def optimize_all_weights(
    db_connection=None,
    days: int = 60,
    stat_types: List[str] = None,
    save: bool = True
) -> Dict[str, LearnedWeights]:
    """
    Optimize weights for all stat types.

    Args:
        db_connection: Database connection
        days: Days of historical data
        stat_types: List of stat types (defaults to all)
        save: Whether to save to database

    Returns:
        Dict mapping stat type to LearnedWeights
    """
    if stat_types is None:
        stat_types = ['Points', 'Rebounds', 'Assists']

    optimizer = WeightOptimizer(db_connection)
    results = {}

    for stat_type in stat_types:
        logger.info(f"Optimizing weights for {stat_type}...")
        weights = optimizer.calculate_weights(stat_type=stat_type, days=days)
        results[stat_type] = weights

        # Print summary
        print(weights.summary())

        # Save to database
        if save and db_connection:
            if optimizer.save_weights(weights):
                logger.info(f"Saved weights for {stat_type}")
            else:
                logger.error(f"Failed to save weights for {stat_type}")

    return results
