"""
Signal-Based Projection Engine

Generates player prop projections by blending individual signals
with learned weights from backtesting.

This engine:
1. Calculates baseline from weighted recent performance
2. Runs all applicable signals
3. Applies learned weights to combine signal adjustments
4. Produces final projection with confidence score and breakdown
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
import logging
import json

logger = logging.getLogger(__name__)


@dataclass
class BlendedProjection:
    """Result of blending all signals into a final projection."""

    # Identification
    player_id: str
    player_name: str
    game_date: str
    stat_type: str
    opponent: str = ""

    # Projection values
    baseline_value: float = 0.0
    final_projection: float = 0.0
    confidence_score: float = 0.5

    # Market data
    line: Optional[float] = None
    predicted_edge: Optional[float] = None
    predicted_direction: Optional[str] = None

    # Signal breakdown
    signals: Dict[str, float] = field(default_factory=dict)
    signal_metadata: Dict[str, Any] = field(default_factory=dict)
    weights_used: Dict[str, float] = field(default_factory=dict)

    # Summary
    signals_fired: int = 0
    total_adjustment: float = 0.0
    over_signals: int = 0
    under_signals: int = 0

    def get_formatted_breakdown(self) -> str:
        """Generate formatted output of projection breakdown."""
        lines = [
            f"\nPROJECTION: {self.player_name} - {self.stat_type}",
            "=" * 50,
            f"Baseline: {self.baseline_value:.1f}",
            "",
            "SIGNAL ADJUSTMENTS:",
        ]

        # Sort by absolute adjustment
        sorted_signals = sorted(
            self.signals.items(),
            key=lambda x: abs(x[1]),
            reverse=True
        )

        for signal_name, adjustment in sorted_signals:
            if adjustment != 0:
                weight = self.weights_used.get(signal_name, 0)
                direction = "↑" if adjustment > 0 else "↓"
                lines.append(
                    f"  {signal_name:<18} {direction} {adjustment:+.1f} "
                    f"(weight: {weight*100:.0f}%)"
                )

        lines.append("")
        lines.append("-" * 50)
        lines.append(f"FINAL PROJECTION: {self.final_projection:.1f}")
        lines.append(f"Confidence: {self.confidence_score*100:.0f}%")

        if self.line is not None:
            lines.append("")
            lines.append(f"Line: {self.line}")
            if self.predicted_edge is not None:
                lines.append(f"Edge: {self.predicted_edge:+.1f}")
            if self.predicted_direction:
                lines.append(f"Direction: {self.predicted_direction}")

        lines.append("=" * 50)
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'player_id': self.player_id,
            'player_name': self.player_name,
            'game_date': self.game_date,
            'stat_type': self.stat_type,
            'opponent': self.opponent,
            'baseline_value': self.baseline_value,
            'final_projection': self.final_projection,
            'confidence_score': self.confidence_score,
            'line': self.line,
            'predicted_edge': self.predicted_edge,
            'predicted_direction': self.predicted_direction,
            'signals': self.signals,
            'signal_metadata': self.signal_metadata,
            'weights_used': self.weights_used,
            'signals_fired': self.signals_fired,
            'total_adjustment': self.total_adjustment,
        }

    def to_db_record(self) -> Dict[str, Any]:
        """Convert to database record format for projection_logs."""
        return {
            'player_id': self.player_id,
            'player_name': self.player_name,
            'game_date': self.game_date,
            'opponent': self.opponent,
            'stat_type': self.stat_type,
            'prizepicks_line': self.line,
            'projected_value': self.final_projection,
            'confidence_score': self.confidence_score,
            'predicted_direction': self.predicted_direction,
            'predicted_edge': self.predicted_edge,
            'signals': json.dumps(self.signals),
            'signal_metadata': json.dumps(self.signal_metadata),
            'weights_used': json.dumps(self.weights_used),
            'baseline_value': self.baseline_value,
        }


class SignalProjectionEngine:
    """
    Projection engine that uses the signal system with learned weights.

    Workflow:
    1. Calculate baseline: 0.35×L3 + 0.30×L5 + 0.20×L10 + 0.15×season
    2. Apply minutes adjustment if projected minutes available
    3. Load learned weights (or use defaults)
    4. Run all applicable signals
    5. Apply: final = baseline + Σ(signal_adjustment × weight)
    6. Calculate confidence based on signal agreement, sample size, and line proximity
    """

    # Baseline calculation weights - enhanced with L3 for recency bias
    L3_WEIGHT = 0.35   # Most recent 3 games - best for trend detection
    L5_WEIGHT = 0.30   # Last 5 games
    L10_WEIGHT = 0.20  # Last 10 games
    SEASON_WEIGHT = 0.15  # Season average
    
    # Minutes adjustment defaults
    DEFAULT_MINUTES = 32.0  # Typical starter minutes

    def __init__(self, db_connection=None):
        """
        Initialize projection engine.

        Args:
            db_connection: Optional database connection for loading weights
        """
        self.db_connection = db_connection
        self._signal_registry = None
        self._weight_optimizer = None
        self._cached_weights: Dict[str, Dict[str, float]] = {}

    @property
    def signal_registry(self):
        """Lazy load signal registry."""
        if self._signal_registry is None:
            from ..signals import registry
            self._signal_registry = registry
        return self._signal_registry

    @property
    def weight_optimizer(self):
        """Lazy load weight optimizer."""
        if self._weight_optimizer is None:
            from ..evaluation.weight_optimizer import WeightOptimizer
            self._weight_optimizer = WeightOptimizer(self.db_connection)
        return self._weight_optimizer

    def project(
        self,
        player_id: str,
        player_name: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any],
        line: Optional[float] = None,
        weights: Optional[Dict[str, float]] = None,
    ) -> BlendedProjection:
        """
        Generate a blended projection for a player/stat.

        Args:
            player_id: Player identifier
            player_name: Player name
            game_date: Game date (YYYY-MM-DD)
            stat_type: Stat type ('Points', 'Rebounds', etc.)
            context: Context dictionary with all data needed by signals
            line: Optional betting line for edge calculation
            weights: Optional weight overrides (loads from DB if not provided)

        Returns:
            BlendedProjection with full breakdown
        """
        # Step 1: Calculate baseline
        baseline = self._calculate_baseline(stat_type, context)

        # Step 2: Load weights
        if weights is None:
            weights = self._get_weights(stat_type)

        # Step 3: Run all signals
        signal_results = self.signal_registry.calculate_all(
            player_id=player_id,
            game_date=game_date,
            stat_type=stat_type,
            context=context,
        )

        # Step 4: Apply weighted adjustments
        total_adjustment = 0.0
        signal_adjustments = {}
        signal_metadata = {}
        signals_fired = 0
        over_count = 0
        under_count = 0

        for signal_name, result in signal_results.items():
            if result.fired:
                signals_fired += 1
                weight = weights.get(signal_name, 0.10)
                weighted_adj = result.adjustment * weight

                total_adjustment += weighted_adj
                signal_adjustments[signal_name] = result.adjustment
                signal_metadata[signal_name] = result.metadata

                if result.direction == 'OVER':
                    over_count += 1
                elif result.direction == 'UNDER':
                    under_count += 1

        # Step 5: Calculate final projection
        final_projection = baseline + total_adjustment
        final_projection = max(0, final_projection)  # Can't be negative

        # Step 6: Calculate confidence (with enhanced factors)
        confidence = self._calculate_confidence(
            signal_results, weights, 
            context=context, 
            line=line, 
            final_projection=final_projection
        )

        # Step 7: Calculate edge if line provided
        predicted_edge = None
        predicted_direction = None

        if line is not None:
            predicted_edge = final_projection - line
            if predicted_edge > 0:
                predicted_direction = 'OVER'
            elif predicted_edge < 0:
                predicted_direction = 'UNDER'

        return BlendedProjection(
            player_id=player_id,
            player_name=player_name,
            game_date=game_date,
            stat_type=stat_type,
            opponent=context.get('opponent', ''),
            baseline_value=baseline,
            final_projection=final_projection,
            confidence_score=confidence,
            line=line,
            predicted_edge=predicted_edge,
            predicted_direction=predicted_direction,
            signals=signal_adjustments,
            signal_metadata=signal_metadata,
            weights_used=weights,
            signals_fired=signals_fired,
            total_adjustment=total_adjustment,
            over_signals=over_count,
            under_signals=under_count,
        )

    def _calculate_baseline(
        self,
        stat_type: str,
        context: Dict[str, Any]
    ) -> float:
        """
        Calculate baseline value using weighted recent performance.

        Baseline = 0.35×L3 + 0.30×L5 + 0.20×L10 + 0.15×season
        
        The L3 weighting gives recency bias to catch:
        - Hot/cold streaks faster
        - Minutes changes from injuries
        - Role changes after trades
        """
        stat_key = self._stat_type_to_key(stat_type)

        season_avgs = context.get('season_averages', {})
        l3_avgs = context.get('last_3_averages', {})
        l5_avgs = context.get('last_5_averages', {})
        l10_avgs = context.get('last_10_averages', {})

        # Get values
        season_val = self._get_stat_value(season_avgs, stat_key, stat_type)
        l3_val = self._get_stat_value(l3_avgs, stat_key, stat_type)
        l5_val = self._get_stat_value(l5_avgs, stat_key, stat_type)
        l10_val = self._get_stat_value(l10_avgs, stat_key, stat_type)

        # Handle missing values - fallback chain: L3 -> L5 -> L10 -> season
        if season_val is None:
            season_val = 0.0
        if l10_val is None:
            l10_val = season_val
        if l5_val is None:
            l5_val = l10_val if l10_val > 0 else season_val
        if l3_val is None:
            l3_val = l5_val  # Fall back to L5 if L3 not available

        # Calculate weighted baseline with L3 recency bias
        baseline = (
            self.L3_WEIGHT * l3_val +
            self.L5_WEIGHT * l5_val +
            self.L10_WEIGHT * l10_val +
            self.SEASON_WEIGHT * season_val
        )
        
        # Apply minutes adjustment if projected minutes differ from average
        baseline = self._apply_minutes_adjustment(baseline, context)

        return baseline
    
    def _apply_minutes_adjustment(
        self,
        baseline: float,
        context: Dict[str, Any]
    ) -> float:
        """
        Adjust baseline based on projected vs average minutes.
        
        If projected minutes are available and differ significantly from
        the player's average, scale the projection accordingly.
        """
        projected_min = context.get('projected_minutes')
        avg_min = context.get('avg_minutes', self.DEFAULT_MINUTES)
        
        if projected_min is None or avg_min is None or avg_min == 0:
            return baseline
        
        # Only apply adjustment if there's a meaningful difference (> 5%)
        min_ratio = projected_min / avg_min
        if abs(min_ratio - 1.0) < 0.05:
            return baseline
        
        # Cap the adjustment at ±30% to avoid extreme swings
        min_ratio = max(0.70, min(1.30, min_ratio))
        
        return baseline * min_ratio

    def _get_weights(self, stat_type: str) -> Dict[str, float]:
        """Get weights for stat type from cache or database."""

        # Check cache first
        if stat_type in self._cached_weights:
            return self._cached_weights[stat_type]

        # Try to load from database
        learned = self.weight_optimizer.load_current_weights(stat_type)
        if learned is not None:
            weights = learned.to_weight_dict()
            self._cached_weights[stat_type] = weights
            return weights

        # Fall back to defaults
        from ..signals import DEFAULT_WEIGHTS
        return DEFAULT_WEIGHTS.copy()

    def _calculate_confidence(
        self,
        signal_results: Dict,
        weights: Dict[str, float],
        context: Dict[str, Any] = None,
        line: Optional[float] = None,
        final_projection: Optional[float] = None
    ) -> float:
        """
        Calculate confidence score based on:
        - Number of signals that fired
        - Agreement between signals (all say OVER vs. mixed)
        - Individual signal confidence scores
        - Weight of signals that fired
        - Sample size penalty (if player has few games)
        - Line proximity factor (lower confidence when projection is near line)
        """
        fired_signals = [r for r in signal_results.values() if r.fired]

        if not fired_signals:
            return 0.3  # Low confidence when no signals fire

        # Count directions
        over_count = sum(1 for r in fired_signals if r.direction == 'OVER')
        under_count = sum(1 for r in fired_signals if r.direction == 'UNDER')
        total_fired = len(fired_signals)

        # Agreement score (0-1)
        if total_fired > 0:
            max_direction = max(over_count, under_count)
            agreement = max_direction / total_fired
        else:
            agreement = 0.5

        # Average confidence from fired signals
        avg_signal_confidence = sum(r.confidence for r in fired_signals) / total_fired

        # Weighted confidence based on signal weights
        weighted_confidence = 0.0
        total_weight = 0.0
        for name, result in signal_results.items():
            if result.fired:
                weight = weights.get(name, 0.10)
                weighted_confidence += result.confidence * weight
                total_weight += weight

        if total_weight > 0:
            weighted_confidence = weighted_confidence / total_weight
        else:
            weighted_confidence = avg_signal_confidence

        # Base confidence from signals
        base_confidence = (
            0.35 * agreement +
            0.35 * avg_signal_confidence +
            0.30 * weighted_confidence
        )
        
        # Sample size penalty - reduce confidence for players with few games
        sample_size_factor = 1.0
        if context:
            games_played = context.get('games_played', 30)
            if games_played < 10:
                sample_size_factor = 0.7  # Significant penalty
            elif games_played < 20:
                sample_size_factor = 0.85  # Moderate penalty
        
        # Line proximity penalty - reduce confidence when close to line
        line_proximity_factor = 1.0
        if line is not None and final_projection is not None:
            edge = abs(final_projection - line)
            if edge < 0.5:
                line_proximity_factor = 0.6  # Very close to line - low confidence
            elif edge < 1.0:
                line_proximity_factor = 0.75  # Close to line
            elif edge < 2.0:
                line_proximity_factor = 0.9  # Moderate edge
            # High edge (>2) keeps full factor
        
        # Combine all factors
        final_confidence = base_confidence * sample_size_factor * line_proximity_factor

        # Scale to reasonable range (0.3 - 0.9)
        final_confidence = 0.3 + final_confidence * 0.6

        return min(0.9, max(0.3, final_confidence))

    def _stat_type_to_key(self, stat_type: str) -> str:
        """Map stat type to key in averages dict."""
        stat_key_map = {
            'Points': 'pts',
            'Rebounds': 'reb',
            'Assists': 'ast',
            '3-Pointers Made': 'fg3m',
            'Pts+Rebs+Asts': 'pra',
        }
        return stat_key_map.get(stat_type, 'pts')

    def _get_stat_value(
        self,
        averages: Dict[str, float],
        stat_key: str,
        stat_type: str
    ) -> Optional[float]:
        """Get stat value from averages dict."""

        if stat_key in averages:
            return averages[stat_key]

        # Handle PRA
        if stat_type == 'Pts+Rebs+Asts':
            pts = averages.get('pts', 0)
            reb = averages.get('reb', 0)
            ast = averages.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast

        return None

    def save_projection(self, projection: BlendedProjection) -> bool:
        """Save projection to projection_logs table."""

        if self.db_connection is None:
            logger.warning("No database connection - cannot save projection")
            return False

        try:
            cursor = self.db_connection.cursor()
            record = projection.to_db_record()

            cursor.execute("""
                INSERT INTO projection_logs (
                    player_id, player_name, game_date, opponent,
                    stat_type, prizepicks_line, projected_value,
                    confidence_score, predicted_direction, predicted_edge,
                    signals, signal_metadata, weights_used, baseline_value,
                    captured_at
                ) VALUES (
                    %(player_id)s, %(player_name)s, %(game_date)s, %(opponent)s,
                    %(stat_type)s, %(prizepicks_line)s, %(projected_value)s,
                    %(confidence_score)s, %(predicted_direction)s, %(predicted_edge)s,
                    %(signals)s, %(signal_metadata)s, %(weights_used)s, %(baseline_value)s,
                    NOW()
                )
                ON CONFLICT (player_id, game_date, stat_type)
                DO UPDATE SET
                    projected_value = EXCLUDED.projected_value,
                    confidence_score = EXCLUDED.confidence_score,
                    predicted_direction = EXCLUDED.predicted_direction,
                    predicted_edge = EXCLUDED.predicted_edge,
                    signals = EXCLUDED.signals,
                    signal_metadata = EXCLUDED.signal_metadata,
                    weights_used = EXCLUDED.weights_used,
                    captured_at = NOW()
            """, record)

            self.db_connection.commit()
            cursor.close()
            return True

        except Exception as e:
            logger.error(f"Error saving projection: {e}")
            self.db_connection.rollback()
            return False

    def batch_project(
        self,
        players: List[Dict[str, Any]],
        game_date: str,
        stat_type: str,
    ) -> List[BlendedProjection]:
        """
        Generate projections for multiple players.

        Args:
            players: List of player dicts with id, name, and context
            game_date: Game date
            stat_type: Stat type

        Returns:
            List of BlendedProjection objects
        """
        projections = []
        weights = self._get_weights(stat_type)

        for player in players:
            try:
                projection = self.project(
                    player_id=player['id'],
                    player_name=player['name'],
                    game_date=game_date,
                    stat_type=stat_type,
                    context=player['context'],
                    line=player.get('line'),
                    weights=weights,
                )
                projections.append(projection)
            except Exception as e:
                logger.error(f"Error projecting {player['name']}: {e}")
                continue

        return projections


def build_context_from_player_data(player_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build context dictionary from player data (e.g., from database).

    Helper function to transform stored player data into the context
    format expected by signals.
    """
    context = {
        'player_name': player_data.get('name', ''),
        'team': player_data.get('team', ''),
    }

    # Parse JSON fields
    for field in ['season_averages', 'last_5_averages', 'last_10_averages',
                  'home_averages', 'away_averages']:
        value = player_data.get(field, {})
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except:
                value = {}
        context[field] = value

    # Position
    if 'position' in player_data:
        context['player_position'] = player_data['position']

    return context
