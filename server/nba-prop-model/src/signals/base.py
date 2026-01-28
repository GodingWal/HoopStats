"""
Signal Base Classes for NBA Prop Model Backtest Infrastructure

This module provides the foundation for modular signal implementations.
Each signal calculates an adjustment to add/subtract from a baseline projection.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
import logging

logger = logging.getLogger(__name__)


@dataclass
class SignalResult:
    """
    Standard output from any signal calculation.

    Attributes:
        adjustment: Points to add/subtract from baseline projection
        direction: Predicted direction ('OVER', 'UNDER', or None if no opinion)
        confidence: 0-1 confidence in this signal's prediction
        signal_name: Name of the signal that produced this result
        fired: Whether the signal had a meaningful opinion
        metadata: Additional context for debugging (e.g., is_b2b=True)
        sample_size: Number of historical samples this signal was based on
        min_sample_required: Minimum samples needed for reliable signal
    """
    adjustment: float = 0.0
    direction: Optional[str] = None  # 'OVER', 'UNDER', or None
    confidence: float = 0.0  # 0.0 to 1.0
    signal_name: str = ""
    fired: bool = False  # Did signal have an opinion?
    metadata: Dict[str, Any] = field(default_factory=dict)
    sample_size: int = 0
    min_sample_required: int = 10

    def __post_init__(self):
        """Validate signal result after initialization."""
        if self.direction and self.direction not in ('OVER', 'UNDER'):
            raise ValueError(f"direction must be 'OVER', 'UNDER', or None, got: {self.direction}")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence must be between 0 and 1, got: {self.confidence}")

    @property
    def is_reliable(self) -> bool:
        """Check if signal has sufficient sample size to be considered reliable."""
        return self.sample_size >= self.min_sample_required

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'adjustment': self.adjustment,
            'direction': self.direction,
            'confidence': self.confidence,
            'signal_name': self.signal_name,
            'fired': self.fired,
            'metadata': self.metadata,
            'sample_size': self.sample_size,
            'min_sample_required': self.min_sample_required,
            'is_reliable': self.is_reliable,
        }


class BaseSignal(ABC):
    """
    Abstract base class for all signals.

    Each signal implementation must:
    1. Define a unique name
    2. Specify which stat types it applies to
    3. Implement the calculate() method

    Attributes:
        name: Unique identifier for this signal (e.g., 'b2b', 'pace')
        description: Human-readable description of what this signal detects
        stat_types: List of stat types this signal applies to
        default_confidence: Base confidence when signal fires
    """

    name: str = "base_signal"
    description: str = ""
    stat_types: List[str] = ["Points", "Rebounds", "Assists"]
    default_confidence: float = 0.5

    @abstractmethod
    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """
        Calculate signal adjustment for a given player/game/stat.

        Args:
            player_id: Unique identifier for the player
            game_date: Date of the game (YYYY-MM-DD format)
            stat_type: Type of stat being projected ('Points', 'Rebounds', etc.)
            context: Dictionary containing all context data needed by signals
                Required keys vary by signal, but typically includes:
                - season_averages: Dict[str, float] with pts, reb, ast, etc.
                - last_5_averages: Dict[str, float]
                - last_10_averages: Dict[str, float]
                Signal-specific keys documented in each signal class.

        Returns:
            SignalResult with adjustment value and metadata
        """
        pass

    def applies_to(self, stat_type: str) -> bool:
        """Check if this signal applies to the given stat type."""
        return stat_type in self.stat_types

    def _create_neutral_result(self) -> SignalResult:
        """Create a neutral result (signal didn't fire)."""
        return SignalResult(
            adjustment=0.0,
            direction=None,
            confidence=0.0,
            signal_name=self.name,
            fired=False,
            metadata={},
        )

    def _create_result(
        self,
        adjustment: float,
        direction: Optional[str],
        confidence: float,
        metadata: Dict[str, Any] = None,
        sample_size: int = 0
    ) -> SignalResult:
        """Helper to create a SignalResult with common fields populated."""
        return SignalResult(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            signal_name=self.name,
            fired=True,
            metadata=metadata or {},
            sample_size=sample_size,
        )


class SignalRegistry:
    """
    Registry of all available signals.

    Provides centralized access to all signal implementations
    and methods to calculate all signals at once.
    """

    def __init__(self):
        """Initialize empty signal registry."""
        self._signals: Dict[str, BaseSignal] = {}

    @property
    def signals(self) -> Dict[str, BaseSignal]:
        """Get all registered signals."""
        return self._signals

    def register(self, signal: BaseSignal) -> None:
        """
        Register a signal with the registry.

        Args:
            signal: Signal instance to register

        Raises:
            ValueError: If signal with same name already registered
        """
        if signal.name in self._signals:
            logger.warning(f"Overwriting existing signal: {signal.name}")
        self._signals[signal.name] = signal
        logger.debug(f"Registered signal: {signal.name}")

    def unregister(self, signal_name: str) -> None:
        """Remove a signal from the registry."""
        if signal_name in self._signals:
            del self._signals[signal_name]
            logger.debug(f"Unregistered signal: {signal_name}")

    def get(self, signal_name: str) -> Optional[BaseSignal]:
        """Get a signal by name."""
        return self._signals.get(signal_name)

    def list_signals(self) -> List[str]:
        """Get list of all registered signal names."""
        return list(self._signals.keys())

    def list_signals_for_stat(self, stat_type: str) -> List[str]:
        """Get list of signal names that apply to a specific stat type."""
        return [
            name for name, signal in self._signals.items()
            if signal.applies_to(stat_type)
        ]

    def calculate_all(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> Dict[str, SignalResult]:
        """
        Calculate all applicable signals for a player/game/stat.

        Args:
            player_id: Unique identifier for the player
            game_date: Date of the game
            stat_type: Type of stat being projected
            context: Context dictionary with all data needed by signals

        Returns:
            Dictionary mapping signal names to their SignalResult
        """
        results = {}

        for name, signal in self._signals.items():
            if signal.applies_to(stat_type):
                try:
                    results[name] = signal.calculate(
                        player_id=player_id,
                        game_date=game_date,
                        stat_type=stat_type,
                        context=context
                    )
                except Exception as e:
                    logger.error(f"Error calculating signal {name}: {e}")
                    # Return neutral result on error
                    results[name] = SignalResult(
                        adjustment=0.0,
                        direction=None,
                        confidence=0.0,
                        signal_name=name,
                        fired=False,
                        metadata={'error': str(e)},
                    )

        return results

    def get_summary(self, results: Dict[str, SignalResult]) -> Dict[str, Any]:
        """
        Get summary statistics for a set of signal results.

        Args:
            results: Dictionary of signal results from calculate_all()

        Returns:
            Summary with counts, total adjustment, direction consensus, etc.
        """
        fired_signals = [r for r in results.values() if r.fired]

        if not fired_signals:
            return {
                'signals_fired': 0,
                'total_adjustment': 0.0,
                'direction_consensus': None,
                'avg_confidence': 0.0,
                'over_signals': 0,
                'under_signals': 0,
            }

        over_count = sum(1 for r in fired_signals if r.direction == 'OVER')
        under_count = sum(1 for r in fired_signals if r.direction == 'UNDER')

        # Determine consensus direction
        if over_count > under_count:
            consensus = 'OVER'
        elif under_count > over_count:
            consensus = 'UNDER'
        else:
            consensus = None  # Mixed signals

        return {
            'signals_fired': len(fired_signals),
            'total_adjustment': sum(r.adjustment for r in fired_signals),
            'direction_consensus': consensus,
            'avg_confidence': sum(r.confidence for r in fired_signals) / len(fired_signals),
            'over_signals': over_count,
            'under_signals': under_count,
        }


# Global registry instance
registry = SignalRegistry()
