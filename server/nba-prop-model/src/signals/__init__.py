"""
Signal Registry for NBA Prop Model

Validated signal system — only signals with demonstrated edge over
coin-flip accuracy are active.  Noise signals (streaks, home/away splits,
referee tendencies, hardcoded defender lists) have been removed.

Active signals (13):
  Tier 1: line_movement, fatigue, minutes_projection, vegas_total
  Tier 2: injury_alpha, usage_redistribution, win_probability, usage_trend
  Tier 3: pace, positional_defense, opponent_recent_form, defense, rest_days
"""

# Import base classes first
from .base import (
    SignalResult,
    BaseSignal,
    SignalRegistry,
    registry,
)

# ── Active signal implementations (auto-register on import) ───────────
from .line_movement import LineMovementSignal
from .fatigue import FatigueSignal
from .minutes_projection import MinutesProjectionSignal
from .vegas_total import VegasTotalSignal
from .injury_alpha import InjuryAlphaSignal
from .usage_redistribution import UsageRedistributionSignal
from .win_probability import WinProbabilitySignal
from .usage_trend import UsageTrendSignal
from .pace_matchup import PaceMatchupSignal
from .defense_vs_position import DefenseVsPositionSignal
from .positional_defense import PositionalDefenseSignal
from .rest_days import RestDaysSignal
from .opponent_recent_form import OpponentRecentFormSignal

# Active signal names matching signal_engine.py
AVAILABLE_SIGNALS = [
    "line_movement",        # Sharp money / steam moves (56-63%)
    "fatigue",              # Continuous fatigue model (55-62%)
    "minutes_projection",   # Minutes-based projection (#1 predictor)
    "vegas_total",          # Game O/U scoring environment (NEW)
    "injury_alpha",         # Teammate injury usage boost
    "usage_redistribution", # Injury-driven opportunity shift
    "win_probability",      # Game-level win probability
    "usage_trend",          # Usage rate & FGA trend (NEW)
    "pace",                 # Opponent pace matchup (54-56%)
    "positional_defense",   # Positional defense quality
    "opponent_recent_form", # Opponent recent defensive form
    "defense",              # Team-level defense vs position
    "rest_days",            # Rest days & opponent fatigue advantage
]

# Default weights — validated signals only
DEFAULT_WEIGHTS = {
    "line_movement": 0.85,
    "fatigue": 0.80,
    "minutes_projection": 0.80,
    "vegas_total": 0.75,
    "injury_alpha": 0.70,
    "usage_redistribution": 0.70,
    "win_probability": 0.70,
    "usage_trend": 0.65,
    "pace": 0.65,
    "positional_defense": 0.65,
    "opponent_recent_form": 0.65,
    "defense": 0.60,
    "rest_days": 0.60,
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
    'LineMovementSignal', 'FatigueSignal', 'MinutesProjectionSignal',
    'VegasTotalSignal', 'InjuryAlphaSignal', 'UsageRedistributionSignal',
    'WinProbabilitySignal', 'UsageTrendSignal', 'PaceMatchupSignal',
    'DefenseVsPositionSignal', 'PositionalDefenseSignal', 'RestDaysSignal',
    'OpponentRecentFormSignal',
    'AVAILABLE_SIGNALS', 'DEFAULT_WEIGHTS', 'SUPPORTED_STAT_TYPES',
    'get_default_weight', 'calculate_blended_adjustment',
    'calculate_direction_confidence',
]
