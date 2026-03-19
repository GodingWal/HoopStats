"""
Correlated Parlay Detection Package

Detects, scores, and surfaces positively correlated PrizePicks prop
combinations that offer hidden +EV due to statistical dependence.
"""

from .correlation_engine import CorrelationEngine
from .parlay_builder import CorrelatedParlayBuilder

__all__ = ["CorrelationEngine", "CorrelatedParlayBuilder"]
