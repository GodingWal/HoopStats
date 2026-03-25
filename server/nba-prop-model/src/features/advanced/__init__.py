"""
Advanced Feature Engineering Pipeline

Elite-tier feature engineering for NBA player prop predictions.
Goes beyond box-score basics with process-oriented, contextual,
and micro-level features that capture WHY a player hits props.

Modules:
    - ewma_features: Exponentially weighted moving averages with decay
    - usage_efficiency: Usage/efficiency derivatives with injury cascade
    - defensive_matchup: Advanced defensive matchup scoring
    - schedule_context: Schedule density, timezone, altitude, travel
    - shot_quality: Quantified Shot Quality (qSQ) framework
    - lineup_rotation: Lineup dynamics and rotation features
    - interaction_terms: Domain-specific interaction features
    - dimensionality: PCA/NMF for high-dimensional feature reduction
    - pipeline: Master orchestrator combining all modules
"""

from .pipeline import AdvancedFeaturePipeline
from .ewma_features import EWMAFeatureEngineer
from .usage_efficiency import UsageEfficiencyEngineer
from .defensive_matchup import DefensiveMatchupEngineer
from .schedule_context import ScheduleContextEngineer
from .shot_quality import ShotQualityEngineer
from .lineup_rotation import LineupRotationEngineer
from .interaction_terms import InteractionTermEngineer
from .dimensionality import DimensionalityReducer

__all__ = [
    "AdvancedFeaturePipeline",
    "EWMAFeatureEngineer",
    "UsageEfficiencyEngineer",
    "DefensiveMatchupEngineer",
    "ScheduleContextEngineer",
    "ShotQualityEngineer",
    "LineupRotationEngineer",
    "InteractionTermEngineer",
    "DimensionalityReducer",
]
