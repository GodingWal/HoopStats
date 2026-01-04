"""
Backtesting Framework
Walk-forward validation for prop betting model
"""
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict

from src.models.distributions import calculate_edge


@dataclass
class BetResult:
    """Result of a single bet"""
    date: str
    player: str
    stat: str
    line: float
    side: str
    model_prob: float
    implied_prob: float
    edge: float
    actual_value: float
    won: bool
    profit: float  # +profit if won, -1 if lost (assuming unit bets)


@dataclass
class BacktestResults:
    """Aggregated backtest results"""
    start_date: str
    end_date: str
    total_bets: int
    wins: int
    losses: int
    
    # Performance metrics
    hit_rate: float
    roi: float
    profit: float
    
    # By stat type
    stats_breakdown: Dict[str, Dict]
    
    # Calibration
    calibration_buckets: Dict[str, float]
    
    # Risk metrics
    max_drawdown: float
    sharpe_ratio: float
    
    # Individual bets
    bets: List[BetResult] = field(default_factory=list)
    
    def summary(self) -> str:
        """Generate summary string"""
        return f"""
Backtest Results ({self.start_date} to {self.end_date})
{'='*50}
Total Bets: {self.total_bets}
Record: {self.wins}-{self.losses}
Hit Rate: {self.hit_rate:.1%}
ROI: {self.roi:.1%}
Total Profit: {self.profit:+.1f} units
Max Drawdown: {self.max_drawdown:.1f} units
Sharpe Ratio: {self.sharpe_ratio:.2f}

By Stat:
{self._format_stats_breakdown()}

Calibration:
{self._format_calibration()}
"""
    
    def _format_stats_breakdown(self) -> str:
        lines = []
        for stat, data in self.stats_breakdown.items():
            lines.append(
                f"  {stat}: {data['wins']}/{data['total']} "
                f"({data['hit_rate']:.1%}) | ROI: {data['roi']:.1%}"
            )
        return "\n".join(lines)
    
    def _format_calibration(self) -> str:
        lines = []
        for bucket, actual_rate in sorted(self.calibration_buckets.items()):
            lines.append(f"  {bucket}: {actual_rate:.1%}")
        return "\n".join(lines)


class Backtester:
    """
    Walk-forward backtesting for prop model
    """
    
    def __init__(
        self,
        min_edge_threshold: float = 0.03,
        odds: int = -110
    ):
        self.min_edge_threshold = min_edge_threshold
        self.odds = odds
        
        # Calculate profit on win based on odds
        if odds < 0:
            self.profit_on_win = 100 / abs(odds)
        else:
            self.profit_on_win = odds / 100
    
    def run_backtest(
        self,
        predictions: pd.DataFrame,
        actuals: pd.DataFrame,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> BacktestResults:
        """
        Run backtest on predictions vs actuals
        
        Args:
            predictions: DataFrame with columns:
                - date, player_id, stat, line, prob_over, prob_under
            actuals: DataFrame with columns:
                - date, player_id, stat, actual_value
        """
        # Merge predictions with actuals
        merged = pd.merge(
            predictions,
            actuals,
            on=['date', 'player_id', 'stat']
        )
        
        # Filter date range
        if start_date:
            merged = merged[merged['date'] >= start_date]
        if end_date:
            merged = merged[merged['date'] <= end_date]
        
        if len(merged) == 0:
            raise ValueError("No matching predictions and actuals found")
        
        # Evaluate each bet
        bets = []
        
        for _, row in merged.iterrows():
            bet = self._evaluate_bet(row)
            if bet is not None:
                bets.append(bet)
        
        # Aggregate results
        return self._aggregate_results(bets, start_date, end_date)
    
    def _evaluate_bet(self, row: pd.Series) -> Optional[BetResult]:
        """Evaluate a single prediction"""
        prob_over = row['prob_over']
        prob_under = row.get('prob_under', 1 - prob_over)
        line = row['line']
        actual = row['actual_value']
        
        # Determine best side
        if prob_over > prob_under:
            side = 'over'
            model_prob = prob_over
            won = actual > line
        else:
            side = 'under'
            model_prob = prob_under
            won = actual < line
        
        # Calculate edge
        edge, ev = calculate_edge(model_prob, self.odds)
        
        # Only bet if edge exceeds threshold
        if edge < self.min_edge_threshold:
            return None
        
        # Implied probability
        if self.odds < 0:
            implied = abs(self.odds) / (abs(self.odds) + 100)
        else:
            implied = 100 / (self.odds + 100)
        
        # Calculate profit
        profit = self.profit_on_win if won else -1.0
        
        return BetResult(
            date=str(row['date']),
            player=row.get('player_name', str(row['player_id'])),
            stat=row['stat'],
            line=line,
            side=side,
            model_prob=model_prob,
            implied_prob=implied,
            edge=edge,
            actual_value=actual,
            won=won,
            profit=profit
        )
    
    def _aggregate_results(
        self,
        bets: List[BetResult],
        start_date: Optional[str],
        end_date: Optional[str]
    ) -> BacktestResults:
        """Aggregate individual bet results"""
        if not bets:
            return BacktestResults(
                start_date=start_date or "",
                end_date=end_date or "",
                total_bets=0,
                wins=0,
                losses=0,
                hit_rate=0,
                roi=0,
                profit=0,
                stats_breakdown={},
                calibration_buckets={},
                max_drawdown=0,
                sharpe_ratio=0,
                bets=[]
            )
        
        total = len(bets)
        wins = sum(1 for b in bets if b.won)
        losses = total - wins
        
        total_profit = sum(b.profit for b in bets)
        roi = total_profit / total
        
        # Stats breakdown
        stats_breakdown = defaultdict(lambda: {'wins': 0, 'total': 0, 'profit': 0})
        for bet in bets:
            stats_breakdown[bet.stat]['total'] += 1
            stats_breakdown[bet.stat]['profit'] += bet.profit
            if bet.won:
                stats_breakdown[bet.stat]['wins'] += 1
        
        for stat in stats_breakdown:
            data = stats_breakdown[stat]
            data['hit_rate'] = data['wins'] / data['total'] if data['total'] > 0 else 0
            data['roi'] = data['profit'] / data['total'] if data['total'] > 0 else 0
        
        # Calibration
        calibration_buckets = self._calculate_calibration(bets)
        
        # Drawdown and Sharpe
        max_drawdown, sharpe = self._calculate_risk_metrics(bets)
        
        return BacktestResults(
            start_date=start_date or bets[0].date,
            end_date=end_date or bets[-1].date,
            total_bets=total,
            wins=wins,
            losses=losses,
            hit_rate=wins / total,
            roi=roi,
            profit=total_profit,
            stats_breakdown=dict(stats_breakdown),
            calibration_buckets=calibration_buckets,
            max_drawdown=max_drawdown,
            sharpe_ratio=sharpe,
            bets=bets
        )
    
    def _calculate_calibration(self, bets: List[BetResult]) -> Dict[str, float]:
        """Check probability calibration by bucket"""
        buckets = {
            '50-55%': (0.50, 0.55),
            '55-60%': (0.55, 0.60),
            '60-65%': (0.60, 0.65),
            '65-70%': (0.65, 0.70),
            '70%+': (0.70, 1.00)
        }
        
        results = {}
        
        for name, (low, high) in buckets.items():
            bucket_bets = [b for b in bets if low <= b.model_prob < high]
            if bucket_bets:
                results[name] = sum(1 for b in bucket_bets if b.won) / len(bucket_bets)
            else:
                results[name] = 0.0
        
        return results
    
    def _calculate_risk_metrics(
        self,
        bets: List[BetResult]
    ) -> Tuple[float, float]:
        """Calculate max drawdown and Sharpe ratio"""
        if not bets:
            return 0.0, 0.0
        
        # Build equity curve
        cumulative = np.cumsum([b.profit for b in bets])
        
        # Max drawdown
        peak = np.maximum.accumulate(cumulative)
        drawdown = peak - cumulative
        max_drawdown = np.max(drawdown)
        
        # Sharpe ratio (assuming daily returns)
        profits = np.array([b.profit for b in bets])
        if len(profits) > 1 and np.std(profits) > 0:
            sharpe = np.mean(profits) / np.std(profits) * np.sqrt(252)  # Annualized
        else:
            sharpe = 0.0
        
        return max_drawdown, sharpe


def calculate_brier_score(
    probabilities: np.ndarray,
    outcomes: np.ndarray
) -> float:
    """
    Calculate Brier score for probability predictions
    
    Lower is better. 0 = perfect, 0.25 = random guessing (for 50/50)
    """
    return np.mean((probabilities - outcomes) ** 2)


def calculate_log_loss(
    probabilities: np.ndarray,
    outcomes: np.ndarray,
    eps: float = 1e-15
) -> float:
    """
    Calculate log loss for probability predictions
    
    Lower is better.
    """
    probs = np.clip(probabilities, eps, 1 - eps)
    return -np.mean(outcomes * np.log(probs) + (1 - outcomes) * np.log(1 - probs))


def calculate_clv(
    model_probs: np.ndarray,
    opening_lines: np.ndarray,
    closing_lines: np.ndarray
) -> float:
    """
    Calculate Closing Line Value
    
    Measures how often your bets beat the closing line.
    """
    # For each bet, check if we got better odds than close
    # Positive CLV = beating the market
    
    clv_values = []
    
    for model_p, open_line, close_line in zip(model_probs, opening_lines, closing_lines):
        # Did line move in our favor?
        if model_p > 0.5:  # We bet over
            # If close line moved down, we got value
            clv = open_line - close_line
        else:  # We bet under
            # If close line moved up, we got value
            clv = close_line - open_line
        
        clv_values.append(clv)
    
    return np.mean(clv_values)


class WalkForwardValidator:
    """
    Walk-forward validation with proper train/test splits
    """
    
    def __init__(
        self,
        train_window: int = 30,  # Days of training data
        test_window: int = 7,    # Days to test before retraining
        min_games: int = 5       # Minimum games for a player to be included
    ):
        self.train_window = train_window
        self.test_window = test_window
        self.min_games = min_games
    
    def create_folds(
        self,
        data: pd.DataFrame,
        date_column: str = 'date'
    ) -> List[Tuple[pd.DataFrame, pd.DataFrame]]:
        """
        Create train/test folds for walk-forward validation
        
        Returns list of (train_df, test_df) tuples
        """
        data = data.sort_values(date_column)
        dates = data[date_column].unique()
        
        folds = []
        
        for i in range(self.train_window, len(dates) - self.test_window, self.test_window):
            train_end_idx = i
            test_end_idx = min(i + self.test_window, len(dates))
            
            train_dates = dates[:train_end_idx]
            test_dates = dates[train_end_idx:test_end_idx]
            
            train_df = data[data[date_column].isin(train_dates)]
            test_df = data[data[date_column].isin(test_dates)]
            
            if len(train_df) > 0 and len(test_df) > 0:
                folds.append((train_df, test_df))
        
        return folds
    
    def run_validation(
        self,
        model,
        data: pd.DataFrame,
        target_column: str,
        date_column: str = 'date'
    ) -> Dict:
        """
        Run full walk-forward validation
        
        Args:
            model: Model with .fit() and .predict() methods
            data: Full dataset
            target_column: Column to predict
        """
        folds = self.create_folds(data, date_column)
        
        all_predictions = []
        all_actuals = []
        
        for train_df, test_df in folds:
            # Fit on training data
            model.fit(train_df)
            
            # Predict on test data
            predictions = model.predict(test_df)
            actuals = test_df[target_column].values
            
            all_predictions.extend(predictions)
            all_actuals.extend(actuals)
        
        predictions = np.array(all_predictions)
        actuals = np.array(all_actuals)
        
        return {
            'n_folds': len(folds),
            'n_predictions': len(predictions),
            'brier_score': calculate_brier_score(predictions, actuals),
            'log_loss': calculate_log_loss(predictions, actuals),
            'predictions': predictions,
            'actuals': actuals
        }
