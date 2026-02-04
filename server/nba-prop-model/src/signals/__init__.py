"""
Signal Registry for NBA Prop Model Backtest Infrastructure

This module provides a modular signal system for generating prop predictions.
Each signal analyzes a specific factor (B2B, pace, injuries, etc.) and
produces an adjustment to add to the baseline projection.

Usage:
    from signals import registry, AVAILABLE_SIGNALS, DEFAULT_WEIGHTS

    # Calculate all signals for a player
    results = registry.calculate_all(
        player_id="201566",
        game_date="2025-01-28",
        stat_type="Points",
        context={
            "season_averages": {"pts": 25.4, "reb": 6.2, "ast": 5.1},
            "is_b2b": True,
            # ... other context
        }
    )

    # Get signal summary
    summary = registry.get_summary(results)
    print(f"Total adjustment: {summary['total_adjustment']}")
"""

# Import base classes first
from .base import (
    SignalResult,
    BaseSignal,
    SignalRegistry,
    registry,
)

# Import all signal implementations (they auto-register on import)
from .back_to_back import BackToBackSignal
from .home_away import HomeAwaySignal
from .recent_form import RecentFormSignal
from .pace_matchup import PaceMatchupSignal
from .defense_vs_position import DefenseVsPositionSignal
from .injury_alpha import InjuryAlphaSignal
from .blowout_risk import BlowoutRiskSignal
from .referee_impact import RefereeImpactSignal

# New signals (v2)
from .clv_tracker import CLVTrackerSignal
from .referee import RefereeSignal
from .defender_matchup import DefenderMatchupSignal
from .line_movement import LineMovementSignal
from .matchup_history import MatchupHistorySignal
from .fatigue import FatigueSignal


# List of available signal names
AVAILABLE_SIGNALS = [
    "b2b",              # Back-to-back fatigue
    "home_away",        # Home/away splits
    "recent_form",      # Hot/cold streaks
    "pace",             # Opponent pace matchup
    "defense",          # Opponent defense vs position
    "injury_alpha",     # Teammate injury boost
    "blowout",          # Blowout risk minutes reduction
    "clv_tracker",      # Closing line value tracking & filtering
    "referee",          # Referee tendency adjustment
    "defender_matchup", # Specific primary defender matchup
    "line_movement",    # Line movement / sharp money detection
    "matchup_history",  # Head-to-head matchup history
    "fatigue",          # Continuous fatigue model (schedule, travel, load)
]

# Default weights for blending signals (sum should be ~1.0 for fired signals)
# These are starting points - will be updated by weight optimizer
DEFAULT_WEIGHTS = {
    "injury_alpha": 0.18,     # Highest - most predictable edge
    "clv_tracker": 0.12,      # CLV is a strong meta-signal
    "b2b": 0.10,              # Strong, well-documented
    "line_movement": 0.10,    # Sharp money signal
    "defender_matchup": 0.08, # Granular defender matchup
    "pace": 0.08,             # Moderate
    "defense": 0.07,          # Moderate (partially overlaps with defender_matchup)
    "blowout": 0.07,          # Moderate
    "fatigue": 0.06,          # Beyond B2B fatigue
    "matchup_history": 0.05,  # Head-to-head history
    "referee": 0.04,          # Referee tendencies
    "home_away": 0.03,        # Lower - splits can be noisy
    "recent_form": 0.02,      # Lowest - often noise
}

# Stat types supported by the signal system
SUPPORTED_STAT_TYPES = [
    "Points",
    "Rebounds",
    "Assists",
    "3-Pointers Made",
    "Pts+Rebs+Asts",
    "Steals",
    "Blocks",
    "Turnovers",
    "Pts+Rebs",
    "Pts+Asts",
    "Rebs+Asts",
]


def get_default_weight(signal_name: str) -> float:
    """Get default weight for a signal."""
    return DEFAULT_WEIGHTS.get(signal_name, 0.10)


def calculate_blended_adjustment(
    results: dict,
    weights: dict = None
) -> tuple:
    """
    Calculate weighted adjustment from signal results.

    Args:
        results: Dict[str, SignalResult] from registry.calculate_all()
        weights: Optional weight overrides (uses DEFAULT_WEIGHTS if not provided)

    Returns:
        Tuple of (total_adjustment, weight_sum, breakdown)
    """
    if weights is None:
        weights = DEFAULT_WEIGHTS

    total_adjustment = 0.0
    weight_sum = 0.0
    breakdown = {}

    for signal_name, result in results.items():
        if result.fired:
            weight = weights.get(signal_name, 0.10)
            weighted_adj = result.adjustment * weight

            total_adjustment += weighted_adj
            weight_sum += weight
            breakdown[signal_name] = {
                'raw_adjustment': result.adjustment,
                'weight': weight,
                'weighted_adjustment': weighted_adj,
                'direction': result.direction,
                'confidence': result.confidence,
            }

    return total_adjustment, weight_sum, breakdown


def calculate_direction_confidence(results: dict) -> tuple:
    """
    Calculate overall direction and confidence from signal results.

    Returns:
        Tuple of (direction, confidence)
        - direction: 'OVER', 'UNDER', or None if mixed
        - confidence: 0-1 based on signal agreement
    """
    fired_signals = [r for r in results.values() if r.fired]

    if not fired_signals:
        return None, 0.0

    over_confidence = sum(
        r.confidence for r in fired_signals if r.direction == 'OVER'
    )
    under_confidence = sum(
        r.confidence for r in fired_signals if r.direction == 'UNDER'
    )
    total_confidence = over_confidence + under_confidence

    if total_confidence == 0:
        return None, 0.0

    if over_confidence > under_confidence:
        direction = 'OVER'
        confidence = over_confidence / total_confidence
    elif under_confidence > over_confidence:
        direction = 'UNDER'
        confidence = under_confidence / total_confidence
    else:
        direction = None
        confidence = 0.5

    return direction, confidence


# Export all public symbols
__all__ = [
    # Base classes
    'SignalResult',
    'BaseSignal',
    'SignalRegistry',
    'registry',

    # Signal implementations (original)
    'BackToBackSignal',
    'HomeAwaySignal',
    'RecentFormSignal',
    'PaceMatchupSignal',
    'DefenseVsPositionSignal',
    'InjuryAlphaSignal',
    'BlowoutRiskSignal',
    'RefereeImpactSignal',

    # Signal implementations (v2)
    'CLVTrackerSignal',
    'RefereeSignal',
    'DefenderMatchupSignal',
    'LineMovementSignal',
    'MatchupHistorySignal',
    'FatigueSignal',

    # Constants
    'AVAILABLE_SIGNALS',
    'DEFAULT_WEIGHTS',
    'SUPPORTED_STAT_TYPES',

    # Helper functions
    'get_default_weight',
    'calculate_blended_adjustment',
    'calculate_direction_confidence',
]
