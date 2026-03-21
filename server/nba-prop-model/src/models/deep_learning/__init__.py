"""
Deep Learning module for NBA player prop predictions.

Implements a hybrid LSTM + MLP architecture using pure NumPy,
requiring no additional dependencies beyond the existing stack.

Architecture:
    - LSTM branch: processes the last N game sequences
    - MLP branch: processes static/contextual features
    - Fusion: combines both branches for final stat projection

Usage:
    from src.models.deep_learning import PropNet, DLTrainingPipeline, ModelStore
"""

from .prop_net import PropNet, PropNetConfig, DLPrediction
from .training import DLTrainingPipeline, TrainingConfig, TrainingExample
from .model_store import ModelStore

__all__ = [
    "PropNet",
    "PropNetConfig",
    "DLPrediction",
    "DLTrainingPipeline",
    "TrainingConfig",
    "TrainingExample",
    "ModelStore",
]
