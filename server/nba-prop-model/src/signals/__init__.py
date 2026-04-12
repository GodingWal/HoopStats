"""
Signal Registry for NBA Prop Model Backtest Infrastructure

This module provides a modular signal system for generating prop predictions.
Each signal analyzes a specific factor (B2B, pace, injuries, etc.) and
produces an adjustment to add to the baseline projection.
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

# V2 signals
from .clv_tracker import CLVTrackerSignal
from .referee import RefereeSignal
from .defender_matchup import DefenderMatchupSignal
from .line_movement import LineMovementSignal
from .matchup_history import MatchupHistorySignal
from .fatigue import FatigueSignal

# Additional signals
from .positional_defense import PositionalDefenseSignal
from .rest_days import RestDaysSignal
from .usage_redistribution import UsageRedistributionSignal
from .minutes_projection import MinutesProjectionSignal
from .win_probability import WinProbabilitySignal

# Consistent list of ALL signal names matching signal_engine.py
AVAILABLE_SIGNALS = [
    "b2b",                  # Back-to-back fatigue
    "home_away",            # Home/away splits
    "recent_form",          # Hot/cold streaks
    "pace",                 # Opponent pace matchup
    "defense",              # Opponent defense vs position
    "positional_defense",   # Positional defense matchup
    "injury_alpha",         # Teammate injury boost
    "usage_redistribution", # Injury-driven usage redistribution
    "blowout_risk",         # Blowout risk minutes reduction (DISABLED - 43%)
    "clv_tracker",          # CLV tracking (DISABLED - 40%)
    "referee",              # Referee tendency adjustment
    "referee_impact",       # Referee impact (legacy)
    "defender_matchup",     # Specific primary defender matchup
    "line_movement",        # Line movement / sharp money detection
    "matchup_history",      # Head-to-head matchup history
    "fatigue",              # Continuous fatigue model
    "rest_days",            # Rest days advantage
    "minutes_projection",   # Minutes-based projection adjustment (NEW)
    "win_probability",       # Game-level win probability model (NEW)
]

# Default weights reflecting signal accuracy data
DEFAULT_WEIGHTS = {
    "line_movement": 0.85,
    "fatigue": 0.80,
    "recent_form": 0.75,
    "minutes_projection": 0.75,
    "win_probability": 0.70,
    "injury_alpha": 0.70,
    "usage_redistribution": 0.70,
    "pace": 0.65,
    "positional_defense": 0.65,
    "home_away": 0.60,
    "defense": 0.60,
    "rest_days": 0.60,
    "b2b": 0.55,
    "defender_matchup": 0.55,
    "matchup_history": 0.55,
    "referee": 0.50,
    "referee_impact": 0.50,
    "blowout_risk": 0.0,    # DISABLED
    "clv_tracker": 0.0,     # DISABLED
}

# All stat types supported
SUPPORTED_STAT_TYPES = [
    "Points", "Rebounds", "Assists", "3-Pointers Made",
    "Pts+Rebs+Asts", "Steals", "Blocks", "Turnovers",
    "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
]


def get_default_weight(signal_name: str) -> float:
    """Get default weight for a signal."""
    return DEFAULT_WEIGHTS.get(signal_name, 0.5)


def calculate_blended_adjustment(results: dict, weights: dict = None) -> float:
    """Calculate blended adjustment from multiple signal results."""
    if weights is None:
        weights = DEFAULT_WEIGHTS
    total = 0.0
    for name, result in results.items():
        if result.fired:
            w = weights.get(name, 0.5)
            total += result.adjustment * w
    return total


def calculate_direction_confidence(results: dict) -> tuple:
    """Calculate consensus direction and confidence from results."""
    over_confidence = 0.0
    under_confidence = 0.0
    total_confidence = 0.0

    for name, result in results.items():
        if result.fired:
            total_confidence += result.confidence
            if result.direction == 'OVER':
                over_confidence += result.confidence
            elif result.direction == 'UNDER':
                under_confidence += result.confidence

    if total_confidence == 0:
        return None, 0.5

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


__all__ = [
    'SignalResult', 'BaseSignal', 'SignalRegistry', 'registry',
    'BackToBackSignal', 'HomeAwaySignal', 'RecentFormSignal',
    'PaceMatchupSignal', 'DefenseVsPositionSignal', 'InjuryAlphaSignal',
    'BlowoutRiskSignal', 'RefereeImpactSignal', 'CLVTrackerSignal',
    'RefereeSignal', 'DefenderMatchupSignal', 'LineMovementSignal',
    'MatchupHistorySignal', 'FatigueSignal', 'PositionalDefenseSignal',
    'RestDaysSignal', 'UsageRedistributionSignal', 'MinutesProjectionSignal',
    'WinProbabilitySignal',
    'AVAILABLE_SIGNALS', 'DEFAULT_WEIGHTS', 'SUPPORTED_STAT_TYPES',
    'get_default_weight', 'calculate_blended_adjustment',
    'calculate_direction_confidence',
]
