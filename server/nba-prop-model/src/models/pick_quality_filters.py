"""
Pick Quality Filters (Quick Wins)

Pre-filters that reject low-quality picks before they reach the recommendation engine.
These are simple, high-impact rules based on known systematic biases:

1. Filter out low-minute players (<20 min/game) - high variance, low predictability
2. Minimum game sample (15+ games this season) - priors can't save tiny samples
3. Signal ROI tracking - drop signals that lose money
4. Injury signal weighting boost - lean into the best signal
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class PickQualityResult:
    """Result of quality filter evaluation."""
    passes: bool
    rejection_reason: Optional[str] = None
    quality_score: float = 1.0  # 0-1, higher = better quality pick
    adjustments: Dict[str, float] = field(default_factory=dict)
    warnings: List[str] = field(default_factory=list)


@dataclass
class SignalROI:
    """Tracked ROI for a signal."""
    signal_name: str
    stat_type: str
    total_bets: int = 0
    wins: int = 0
    losses: int = 0
    total_profit: float = 0.0

    @property
    def win_rate(self) -> float:
        if self.total_bets == 0:
            return 0.0
        return self.wins / self.total_bets

    @property
    def roi(self) -> float:
        if self.total_bets == 0:
            return 0.0
        return self.total_profit / self.total_bets

    @property
    def is_profitable(self) -> bool:
        return self.total_bets >= 20 and self.roi > -0.02


class PickQualityFilter:
    """
    Pre-filters low-quality picks to improve overall win rate.

    Applies a series of filters and adjustments before generating
    a betting recommendation.
    """

    # Minimum minutes per game to consider a pick
    MIN_MINUTES_THRESHOLD = 20.0

    # Minimum games played this season
    MIN_GAMES_THRESHOLD = 15

    # Minimum edge to recommend a bet
    MIN_EDGE_THRESHOLD = 0.03  # 3%

    # Boost multiplier for injury signal (our best signal)
    INJURY_SIGNAL_BOOST = 1.3

    # Maximum weight reduction for underperforming signals
    SIGNAL_PENALTY_FACTOR = 0.5

    # Minimum confidence to recommend
    MIN_CONFIDENCE = 0.45

    def __init__(self):
        """Initialize filter with ROI tracking."""
        self._signal_roi: Dict[str, Dict[str, SignalROI]] = {}

    def evaluate_pick(
        self,
        context: Dict[str, Any],
        signal_results: Dict[str, Any] = None,
    ) -> PickQualityResult:
        """
        Evaluate whether a pick meets quality standards.

        Args:
            context: Full context dict for the player/game
            signal_results: Results from signal calculations

        Returns:
            PickQualityResult with pass/fail and adjustments
        """
        warnings = []
        adjustments = {}
        quality_score = 1.0

        # Filter 1: Minimum minutes
        avg_minutes = context.get('avg_minutes', 0)
        season_avgs = context.get('season_averages', {})
        if avg_minutes <= 0:
            # Try to infer from season averages
            avg_minutes = season_avgs.get('min', 0)

        if avg_minutes < self.MIN_MINUTES_THRESHOLD:
            return PickQualityResult(
                passes=False,
                rejection_reason=f"Low minutes ({avg_minutes:.1f} mpg < {self.MIN_MINUTES_THRESHOLD})",
                quality_score=0.2,
            )

        # Filter 2: Minimum games played
        games_played = context.get('games_played', 0)
        if games_played < self.MIN_GAMES_THRESHOLD:
            return PickQualityResult(
                passes=False,
                rejection_reason=f"Small sample ({games_played} games < {self.MIN_GAMES_THRESHOLD})",
                quality_score=0.3,
            )

        # Filter 3: Check for extremely high variance players
        minutes_std = context.get('minutes_std', 0)
        if avg_minutes > 0 and minutes_std > 0:
            minutes_cv = minutes_std / avg_minutes
            if minutes_cv > 0.30:
                # Very inconsistent minutes = unpredictable
                quality_score *= 0.7
                warnings.append(f"High minutes variance (CV={minutes_cv:.2f})")

        # Adjustment 1: Boost injury signal weight
        if signal_results:
            injury_result = signal_results.get('injury_alpha')
            if injury_result and hasattr(injury_result, 'fired') and injury_result.fired:
                # Our best signal - boost its impact
                adjustments['injury_alpha_boost'] = self.INJURY_SIGNAL_BOOST
                quality_score = min(quality_score * 1.15, 1.0)

        # Adjustment 2: Penalize signals with negative ROI
        if signal_results:
            stat_type = context.get('stat_type', 'Points')
            for signal_name, result in signal_results.items():
                if not hasattr(result, 'fired') or not result.fired:
                    continue

                roi_data = self._get_signal_roi(signal_name, stat_type)
                if roi_data and not roi_data.is_profitable:
                    adjustments[f'{signal_name}_penalty'] = self.SIGNAL_PENALTY_FACTOR
                    warnings.append(f"Signal '{signal_name}' has negative ROI ({roi_data.roi:.1%})")
                    quality_score *= 0.9

        # Adjustment 3: Low-scoring players with counting stats have higher variance
        pts_avg = season_avgs.get('pts', 0)
        if pts_avg < 10 and context.get('stat_type') in ('Points', 'Pts+Rebs+Asts'):
            quality_score *= 0.8
            warnings.append("Low-volume scorer (high variance)")

        # Adjustment 4: 3PM for non-shooters
        fg3a = season_avgs.get('fg3a', 0)
        if context.get('stat_type') == '3-Pointers Made' and fg3a < 3.0:
            quality_score *= 0.7
            warnings.append("Low 3PA volume (< 3.0 per game)")

        # Adjustment 5: Extra trust in games with many fired signals
        if signal_results:
            fired_count = sum(1 for r in signal_results.values()
                            if hasattr(r, 'fired') and r.fired)
            if fired_count >= 4:
                quality_score = min(quality_score * 1.1, 1.0)
            elif fired_count <= 1:
                quality_score *= 0.9
                warnings.append("Few signals fired (low information)")

        return PickQualityResult(
            passes=True,
            quality_score=quality_score,
            adjustments=adjustments,
            warnings=warnings,
        )

    def get_adjusted_weights(
        self,
        base_weights: Dict[str, float],
        quality_result: PickQualityResult,
    ) -> Dict[str, float]:
        """
        Adjust signal weights based on quality filter results.

        Args:
            base_weights: Default signal weights
            quality_result: Result from evaluate_pick()

        Returns:
            Adjusted weights dict
        """
        adjusted = base_weights.copy()

        for adj_key, adj_value in quality_result.adjustments.items():
            if adj_key == 'injury_alpha_boost':
                if 'injury_alpha' in adjusted:
                    adjusted['injury_alpha'] *= adj_value
            elif adj_key.endswith('_penalty'):
                signal_name = adj_key.replace('_penalty', '')
                if signal_name in adjusted:
                    adjusted[signal_name] *= adj_value

        # Re-normalize weights so they sum to ~1.0
        total = sum(adjusted.values())
        if total > 0:
            for k in adjusted:
                adjusted[k] /= total

        return adjusted

    def record_outcome(
        self,
        signal_name: str,
        stat_type: str,
        won: bool,
        profit: float,
    ):
        """Record a bet outcome for ROI tracking."""
        if stat_type not in self._signal_roi:
            self._signal_roi[stat_type] = {}

        if signal_name not in self._signal_roi[stat_type]:
            self._signal_roi[stat_type][signal_name] = SignalROI(
                signal_name=signal_name,
                stat_type=stat_type,
            )

        roi = self._signal_roi[stat_type][signal_name]
        roi.total_bets += 1
        if won:
            roi.wins += 1
        else:
            roi.losses += 1
        roi.total_profit += profit

    def _get_signal_roi(
        self,
        signal_name: str,
        stat_type: str,
    ) -> Optional[SignalROI]:
        """Get ROI data for a signal/stat combo."""
        if stat_type in self._signal_roi:
            return self._signal_roi[stat_type].get(signal_name)
        return None

    def get_roi_summary(self) -> Dict[str, Dict[str, Dict]]:
        """Get summary of all signal ROI tracking."""
        summary = {}
        for stat_type, signals in self._signal_roi.items():
            summary[stat_type] = {}
            for signal_name, roi in signals.items():
                summary[stat_type][signal_name] = {
                    'total_bets': roi.total_bets,
                    'win_rate': roi.win_rate,
                    'roi': roi.roi,
                    'is_profitable': roi.is_profitable,
                }
        return summary
