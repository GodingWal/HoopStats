"""
Evaluation Module for NBA Prop Model

Contains backtesting, signal validation, and weight optimization tools.
"""

from .backtester import (
    Backtester,
    BetResult,
    BacktestResults,
    WalkForwardValidator,
    calculate_brier_score,
    calculate_log_loss,
    calculate_clv,
)

from .backtest_engine import (
    BacktestEngine,
    SignalAccuracy,
    run_full_backtest,
)

from .weight_optimizer import (
    WeightOptimizer,
    SignalWeight,
    LearnedWeights,
    optimize_all_weights,
)


__all__ = [
    # Original backtester
    'Backtester',
    'BetResult',
    'BacktestResults',
    'WalkForwardValidator',
    'calculate_brier_score',
    'calculate_log_loss',
    'calculate_clv',

    # Signal backtest engine
    'BacktestEngine',
    'SignalAccuracy',
    'run_full_backtest',

    # Weight optimizer
    'WeightOptimizer',
    'SignalWeight',
    'LearnedWeights',
    'optimize_all_weights',
]
