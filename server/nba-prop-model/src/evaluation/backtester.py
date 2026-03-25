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
    closing_line: Optional[float] = None  # Closing line for CLV calc
    best_odds: Optional[int] = None  # Best available odds across books
    sportsbook: Optional[str] = None  # Sportsbook used


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

    # Probabilistic evaluation metrics
    brier_score: float = 0.0
    log_loss: float = 0.0
    expected_calibration_error: float = 0.0  # ECE
    avg_clv: float = 0.0  # Average Closing Line Value
    clv_positive_rate: float = 0.0  # % of bets with positive CLV

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

Probabilistic Metrics:
  Brier Score: {self.brier_score:.4f}
  Log Loss: {self.log_loss:.4f}
  ECE: {self.expected_calibration_error:.4f}
  Avg CLV: {self.avg_clv:+.3f}
  CLV+ Rate: {self.clv_positive_rate:.1%}

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
    Walk-forward backtesting for prop model.

    Supports:
    - No-vig fair odds (devigging) for accurate edge calculation
    - Line shopping across multiple sportsbooks
    - Multi-season date ranges
    - Full probabilistic evaluation (Brier, ECE, log-loss, CLV)
    """

    def __init__(
        self,
        min_edge_threshold: float = 0.03,
        odds: int = -110,
        use_devig: bool = True,
        use_line_shopping: bool = False,
    ):
        self.min_edge_threshold = min_edge_threshold
        self.odds = odds
        self.use_devig = use_devig
        self.use_line_shopping = use_line_shopping

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
        end_date: Optional[str] = None,
        multi_book_lines: Optional[pd.DataFrame] = None,
        seasons: Optional[List[str]] = None,
    ) -> BacktestResults:
        """
        Run backtest on predictions vs actuals.

        Args:
            predictions: DataFrame with columns:
                - date, player_id, stat, line, prob_over, prob_under
                - Optional: over_odds, under_odds (for devigging)
                - Optional: closing_line (for CLV)
            actuals: DataFrame with columns:
                - date, player_id, stat, actual_value
            multi_book_lines: Optional DataFrame for line shopping with columns:
                - date, player_id, stat, sportsbook, line, over_odds, under_odds
            seasons: Optional list of season strings (e.g. ['2023-24', '2024-25'])
                     to run multi-season backtest
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

        # Multi-season filtering
        if seasons:
            merged = self._filter_by_seasons(merged, seasons)

        if len(merged) == 0:
            raise ValueError("No matching predictions and actuals found")

        # If line shopping enabled, attach best available lines
        if self.use_line_shopping and multi_book_lines is not None:
            merged = self._attach_best_lines(merged, multi_book_lines)

        # Evaluate each bet
        bets = []

        for _, row in merged.iterrows():
            bet = self._evaluate_bet(row)
            if bet is not None:
                bets.append(bet)

        # Aggregate results
        return self._aggregate_results(bets, start_date, end_date)

    def _filter_by_seasons(self, data: pd.DataFrame, seasons: List[str]) -> pd.DataFrame:
        """Filter data to include only specified NBA seasons (Oct-Jun)."""
        masks = []
        for season in seasons:
            parts = season.split('-')
            if len(parts) == 2:
                start_year = int(parts[0]) if len(parts[0]) == 4 else int('20' + parts[0])
                end_year = int(parts[1]) if len(parts[1]) == 4 else int('20' + parts[1])
            else:
                continue
            season_start = f"{start_year}-10-01"
            season_end = f"{end_year}-06-30"
            mask = (data['date'] >= season_start) & (data['date'] <= season_end)
            masks.append(mask)
        if masks:
            combined = masks[0]
            for m in masks[1:]:
                combined = combined | m
            return data[combined]
        return data

    def _attach_best_lines(
        self, merged: pd.DataFrame, multi_book_lines: pd.DataFrame
    ) -> pd.DataFrame:
        """Attach best available odds from multi-book data for line shopping."""
        best_rows = []
        for _, row in multi_book_lines.iterrows():
            best_rows.append(row)

        if not best_rows:
            return merged

        # Group multi-book lines by (date, player_id, stat) and find best odds
        grouped = multi_book_lines.groupby(['date', 'player_id', 'stat'])
        best_lines = []
        for (date, pid, stat), group in grouped:
            # Best over odds = highest payout for over
            best_over_idx = group['over_odds'].idxmax() if 'over_odds' in group.columns else None
            best_under_idx = group['under_odds'].idxmax() if 'under_odds' in group.columns else None

            best_over_odds = int(group.loc[best_over_idx, 'over_odds']) if best_over_idx is not None else self.odds
            best_under_odds = int(group.loc[best_under_idx, 'under_odds']) if best_under_idx is not None else self.odds
            best_over_book = group.loc[best_over_idx, 'sportsbook'] if best_over_idx is not None else 'default'
            best_under_book = group.loc[best_under_idx, 'sportsbook'] if best_under_idx is not None else 'default'

            best_lines.append({
                'date': date,
                'player_id': pid,
                'stat': stat,
                'best_over_odds': best_over_odds,
                'best_under_odds': best_under_odds,
                'best_over_book': best_over_book,
                'best_under_book': best_under_book,
            })

        if best_lines:
            best_df = pd.DataFrame(best_lines)
            merged = pd.merge(merged, best_df, on=['date', 'player_id', 'stat'], how='left')

        return merged

    def _evaluate_bet(self, row: pd.Series) -> Optional[BetResult]:
        """Evaluate a single prediction with devigging and line shopping support."""
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

        # Get odds — use best available if line shopping is active
        if self.use_line_shopping and 'best_over_odds' in row.index:
            if side == 'over':
                bet_odds = row.get('best_over_odds', self.odds)
                sportsbook = row.get('best_over_book', None)
            else:
                bet_odds = row.get('best_under_odds', self.odds)
                sportsbook = row.get('best_under_book', None)
            bet_odds = int(bet_odds) if not pd.isna(bet_odds) else self.odds
        else:
            bet_odds = self.odds
            sportsbook = None

        # Calculate implied probability — with or without vig removal
        if self.use_devig and 'over_odds' in row.index and 'under_odds' in row.index:
            over_odds = row.get('over_odds', self.odds)
            under_odds = row.get('under_odds', self.odds)
            if not pd.isna(over_odds) and not pd.isna(under_odds):
                implied = devig_to_fair_prob(
                    int(over_odds), int(under_odds),
                    side=side
                )
            else:
                implied = _american_to_implied(bet_odds)
        else:
            implied = _american_to_implied(bet_odds)

        # Calculate edge against fair (no-vig) probability
        edge = model_prob - implied

        # Only bet if edge exceeds threshold
        if edge < self.min_edge_threshold:
            return None

        # Calculate profit using actual bet odds (with vig — what you'd really get)
        if bet_odds < 0:
            profit_on_win = 100 / abs(bet_odds)
        else:
            profit_on_win = bet_odds / 100
        profit = profit_on_win if won else -1.0

        # Closing line for CLV
        closing_line = row.get('closing_line', None)
        if closing_line is not None and pd.isna(closing_line):
            closing_line = None

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
            profit=profit,
            closing_line=float(closing_line) if closing_line is not None else None,
            best_odds=bet_odds if self.use_line_shopping else None,
            sportsbook=sportsbook,
        )
    
    def _aggregate_results(
        self,
        bets: List[BetResult],
        start_date: Optional[str],
        end_date: Optional[str]
    ) -> BacktestResults:
        """Aggregate individual bet results with full probabilistic metrics."""
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
                brier_score=0,
                log_loss=0,
                expected_calibration_error=0,
                avg_clv=0,
                clv_positive_rate=0,
                bets=[]
            )

        total = len(bets)
        wins = sum(1 for b in bets if b.won)
        losses = total - wins

        total_profit = sum(b.profit for b in bets)
        roi = total_profit / total

        # Stats breakdown with per-stat Brier/ROI
        stats_breakdown = defaultdict(lambda: {
            'wins': 0, 'total': 0, 'profit': 0,
            'probs': [], 'outcomes': [],
        })
        for bet in bets:
            stats_breakdown[bet.stat]['total'] += 1
            stats_breakdown[bet.stat]['profit'] += bet.profit
            stats_breakdown[bet.stat]['probs'].append(bet.model_prob)
            stats_breakdown[bet.stat]['outcomes'].append(1.0 if bet.won else 0.0)
            if bet.won:
                stats_breakdown[bet.stat]['wins'] += 1

        for stat in stats_breakdown:
            data = stats_breakdown[stat]
            data['hit_rate'] = data['wins'] / data['total'] if data['total'] > 0 else 0
            data['roi'] = data['profit'] / data['total'] if data['total'] > 0 else 0
            # Per-stat Brier score
            if data['probs']:
                probs_arr = np.array(data['probs'])
                outcomes_arr = np.array(data['outcomes'])
                data['brier_score'] = float(calculate_brier_score(probs_arr, outcomes_arr))
            else:
                data['brier_score'] = 0.0
            # Clean up temp lists from serializable output
            del data['probs']
            del data['outcomes']

        # Calibration buckets
        calibration_buckets = self._calculate_calibration(bets)

        # Drawdown and Sharpe
        max_drawdown, sharpe = self._calculate_risk_metrics(bets)

        # Probabilistic metrics
        probs = np.array([b.model_prob for b in bets])
        outcomes = np.array([1.0 if b.won else 0.0 for b in bets])
        brier = float(calculate_brier_score(probs, outcomes))
        logloss = float(calculate_log_loss(probs, outcomes))
        ece = float(calculate_expected_calibration_error(probs, outcomes))

        # CLV metrics
        avg_clv, clv_pos_rate = self._calculate_clv_metrics(bets)

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
            brier_score=brier,
            log_loss=logloss,
            expected_calibration_error=ece,
            avg_clv=avg_clv,
            clv_positive_rate=clv_pos_rate,
            bets=bets
        )

    def _calculate_clv_metrics(self, bets: List[BetResult]) -> Tuple[float, float]:
        """Calculate CLV metrics from bets that have closing line data."""
        bets_with_cl = [b for b in bets if b.closing_line is not None]
        if not bets_with_cl:
            return 0.0, 0.0

        clv_values = []
        for bet in bets_with_cl:
            opening = bet.line
            closing = bet.closing_line
            if bet.side == 'over':
                clv = opening - closing  # Line dropped = we got value
            else:
                clv = closing - opening  # Line rose = we got value
            clv_values.append(clv)

        avg_clv = float(np.mean(clv_values))
        clv_pos_rate = sum(1 for c in clv_values if c > 0) / len(clv_values)
        return avg_clv, clv_pos_rate
    
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


    def sweep_thresholds(
        self,
        predictions: pd.DataFrame,
        actuals: pd.DataFrame,
        threshold_ranges: Optional[Dict[str, List[float]]] = None,
        validation_split: float = 0.2
    ) -> Dict:
        """
        Sweep confidence thresholds to find optimal values using out-of-sample data.

        Tests combinations of HIGH_OVER, MEDIUM_OVER, HIGH_UNDER, MEDIUM_UNDER
        thresholds and returns the combination that maximizes ROI on the
        validation set.

        Args:
            predictions: Full prediction dataset
            actuals: Full actuals dataset
            threshold_ranges: Override ranges, or use defaults
            validation_split: Fraction of data reserved for validation (0.2 = last 20%)

        Returns:
            Dict with 'best_thresholds', 'best_roi', 'all_results'
        """
        if threshold_ranges is None:
            threshold_ranges = {
                'HIGH_OVER': [65.0, 68.0, 70.0, 72.0, 75.0],
                'MEDIUM_OVER': [52.0, 55.0, 58.0, 60.0],
                'HIGH_UNDER': [25.0, 28.0, 30.0, 32.0, 35.0],
                'MEDIUM_UNDER': [40.0, 42.0, 45.0, 48.0],
                'MIN_EDGE': [0.03, 0.05, 0.07, 0.10],
            }

        # Split data temporally (not randomly) to avoid lookahead bias
        merged = pd.merge(predictions, actuals, on=['date', 'player_id', 'stat'])
        merged = merged.sort_values('date')

        split_idx = int(len(merged) * (1 - validation_split))
        train_data = merged.iloc[:split_idx]
        val_data = merged.iloc[split_idx:]

        best_roi = -float('inf')
        best_thresholds = {}
        all_results = []

        # Sweep combinations
        for min_edge in threshold_ranges.get('MIN_EDGE', [0.05]):
            for high_over in threshold_ranges.get('HIGH_OVER', [70.0]):
                for med_over in threshold_ranges.get('MEDIUM_OVER', [55.0]):
                    if med_over >= high_over:
                        continue
                    for high_under in threshold_ranges.get('HIGH_UNDER', [30.0]):
                        for med_under in threshold_ranges.get('MEDIUM_UNDER', [45.0]):
                            if med_under <= high_under:
                                continue

                            # Apply thresholds to validation data
                            self.min_edge_threshold = min_edge

                            # Filter validation bets by these thresholds
                            val_bets = []
                            for _, row in val_data.iterrows():
                                prob_over = row['prob_over']
                                hit_rate_pct = prob_over * 100

                                # Apply confidence thresholds
                                qualifies = False
                                if hit_rate_pct >= high_over:
                                    qualifies = True
                                elif hit_rate_pct >= med_over:
                                    qualifies = True
                                elif hit_rate_pct <= high_under:
                                    qualifies = True
                                elif hit_rate_pct <= med_under:
                                    qualifies = True

                                if qualifies:
                                    bet = self._evaluate_bet(row)
                                    if bet is not None:
                                        val_bets.append(bet)

                            if len(val_bets) >= 10:  # Need minimum bets for reliability
                                total_profit = sum(b.profit for b in val_bets)
                                roi = total_profit / len(val_bets)
                                hit_rate = sum(1 for b in val_bets if b.won) / len(val_bets)

                                result = {
                                    'HIGH_OVER': high_over,
                                    'MEDIUM_OVER': med_over,
                                    'HIGH_UNDER': high_under,
                                    'MEDIUM_UNDER': med_under,
                                    'MIN_EDGE': min_edge,
                                    'roi': roi,
                                    'hit_rate': hit_rate,
                                    'num_bets': len(val_bets),
                                    'profit': total_profit,
                                }
                                all_results.append(result)

                                if roi > best_roi:
                                    best_roi = roi
                                    best_thresholds = result.copy()

        return {
            'best_thresholds': best_thresholds,
            'best_roi': best_roi,
            'all_results': sorted(all_results, key=lambda x: x['roi'], reverse=True)[:20],
            'validation_size': len(val_data),
            'train_size': len(train_data),
        }


# ==================== UTILITY FUNCTIONS ====================


def _american_to_implied(odds: int) -> float:
    """Convert American odds to implied probability (with vig)."""
    if odds < 0:
        return abs(odds) / (abs(odds) + 100)
    elif odds > 0:
        return 100 / (odds + 100)
    return 0.5


def devig_to_fair_prob(
    over_odds: int,
    under_odds: int,
    side: str = 'over',
    method: str = 'multiplicative',
) -> float:
    """
    Remove vig from a two-way market to get the true fair probability.

    Methods:
    - 'multiplicative' (default): Scale implied probs proportionally
      (most common, assumes vig is distributed proportional to probability)
    - 'additive': Subtract equal vig from each side
    - 'power': Shin's method — better for sharp markets
    - 'worst_case': Use the higher implied prob (conservative)

    Args:
        over_odds: American odds for the over
        under_odds: American odds for the under
        side: Which side's fair prob to return ('over' or 'under')
        method: Devigging method

    Returns:
        Fair (no-vig) probability for the requested side
    """
    impl_over = _american_to_implied(over_odds)
    impl_under = _american_to_implied(under_odds)
    total = impl_over + impl_under  # > 1.0 due to vig
    vig = total - 1.0

    if method == 'multiplicative':
        fair_over = impl_over / total
        fair_under = impl_under / total
    elif method == 'additive':
        half_vig = vig / 2.0
        fair_over = max(impl_over - half_vig, 0.01)
        fair_under = max(impl_under - half_vig, 0.01)
        # Re-normalize
        s = fair_over + fair_under
        fair_over /= s
        fair_under /= s
    elif method == 'power':
        # Shin's method approximation
        z = vig / total
        fair_over = impl_over * (1 - z) / (1 - z * impl_over)
        fair_under = 1.0 - fair_over
    elif method == 'worst_case':
        # Conservative: assume all vig is on your side
        fair_over = impl_over - vig
        fair_under = impl_under - vig
        fair_over = max(fair_over, 0.01)
        fair_under = max(fair_under, 0.01)
    else:
        fair_over = impl_over / total
        fair_under = impl_under / total

    return fair_over if side == 'over' else fair_under


def calculate_brier_score(
    probabilities: np.ndarray,
    outcomes: np.ndarray
) -> float:
    """
    Calculate Brier score for probability predictions.

    Lower is better. 0 = perfect, 0.25 = random guessing (for 50/50).
    """
    return float(np.mean((probabilities - outcomes) ** 2))


def calculate_log_loss(
    probabilities: np.ndarray,
    outcomes: np.ndarray,
    eps: float = 1e-15
) -> float:
    """
    Calculate log loss for probability predictions.

    Lower is better.
    """
    probs = np.clip(probabilities, eps, 1 - eps)
    return float(-np.mean(outcomes * np.log(probs) + (1 - outcomes) * np.log(1 - probs)))


def calculate_expected_calibration_error(
    probabilities: np.ndarray,
    outcomes: np.ndarray,
    n_bins: int = 10,
) -> float:
    """
    Calculate Expected Calibration Error (ECE).

    ECE measures the weighted average gap between predicted probability
    and actual hit rate across probability bins.

    Lower is better. 0 = perfectly calibrated.
    """
    bin_edges = np.linspace(0, 1, n_bins + 1)
    total = len(probabilities)
    if total == 0:
        return 0.0

    ece = 0.0
    for i in range(n_bins):
        mask = (probabilities >= bin_edges[i]) & (probabilities < bin_edges[i + 1])
        count = mask.sum()
        if count == 0:
            continue
        avg_pred = float(probabilities[mask].mean())
        avg_true = float(outcomes[mask].mean())
        ece += (count / total) * abs(avg_true - avg_pred)

    return ece


def calculate_clv(
    model_probs: np.ndarray,
    opening_lines: np.ndarray,
    closing_lines: np.ndarray
) -> float:
    """
    Calculate Closing Line Value.

    Measures how often your bets beat the closing line.
    Positive CLV = beating the market (the real proof of edge).
    """
    clv_values = []

    for model_p, open_line, close_line in zip(model_probs, opening_lines, closing_lines):
        if model_p > 0.5:  # We bet over
            clv = open_line - close_line
        else:  # We bet under
            clv = close_line - open_line
        clv_values.append(clv)

    return float(np.mean(clv_values))


def simulate_full_betting(
    predictions: pd.DataFrame,
    closing_lines: pd.DataFrame,
    actuals: pd.DataFrame,
    min_edge: float = 0.03,
) -> Dict:
    """
    Full betting simulation comparing model probs vs closing lines for CLV.

    This is "the real proof of edge" — if you consistently beat the closing line,
    your model has predictive power regardless of short-term variance.

    Args:
        predictions: DataFrame with date, player_id, stat, line, prob_over, prob_under,
                     over_odds, under_odds
        closing_lines: DataFrame with date, player_id, stat, closing_line,
                       closing_over_odds, closing_under_odds
        actuals: DataFrame with date, player_id, stat, actual_value

    Returns:
        Dict with CLV analysis, bet-level CLV, and comparison metrics
    """
    merged = pd.merge(predictions, closing_lines, on=['date', 'player_id', 'stat'])
    merged = pd.merge(merged, actuals, on=['date', 'player_id', 'stat'])

    results = []
    for _, row in merged.iterrows():
        prob_over = row['prob_over']
        prob_under = row.get('prob_under', 1 - prob_over)

        if prob_over > prob_under:
            side = 'over'
            model_prob = prob_over
            won = row['actual_value'] > row['line']
        else:
            side = 'under'
            model_prob = prob_under
            won = row['actual_value'] < row['line']

        # Devig opening odds to get fair probability
        over_odds = row.get('over_odds', -110)
        under_odds = row.get('under_odds', -110)
        fair_prob = devig_to_fair_prob(int(over_odds), int(under_odds), side=side)

        edge = model_prob - fair_prob
        if edge < min_edge:
            continue

        # Devig closing odds for CLV comparison
        cl_over = row.get('closing_over_odds', over_odds)
        cl_under = row.get('closing_under_odds', under_odds)
        closing_fair = devig_to_fair_prob(int(cl_over), int(cl_under), side=side)

        # CLV = our fair prob at open vs fair prob at close
        # If closing fair moved toward our prediction, we captured CLV
        clv = closing_fair - fair_prob  # Positive = market agreed with us

        results.append({
            'date': str(row['date']),
            'player': row.get('player_name', str(row['player_id'])),
            'stat': row['stat'],
            'side': side,
            'model_prob': model_prob,
            'opening_fair': fair_prob,
            'closing_fair': closing_fair,
            'edge_at_open': edge,
            'clv': clv,
            'won': won,
        })

    if not results:
        return {
            'total_bets': 0,
            'avg_clv': 0,
            'clv_positive_rate': 0,
            'avg_edge': 0,
            'hit_rate': 0,
            'bets': [],
        }

    clv_vals = [r['clv'] for r in results]
    return {
        'total_bets': len(results),
        'avg_clv': float(np.mean(clv_vals)),
        'median_clv': float(np.median(clv_vals)),
        'clv_positive_rate': sum(1 for c in clv_vals if c > 0) / len(clv_vals),
        'avg_edge': float(np.mean([r['edge_at_open'] for r in results])),
        'hit_rate': sum(1 for r in results if r['won']) / len(results),
        'clv_by_stat': _clv_by_stat(results),
        'bets': results,
    }


def _clv_by_stat(results: List[Dict]) -> Dict[str, Dict]:
    """Break down CLV metrics by stat type."""
    by_stat = defaultdict(list)
    for r in results:
        by_stat[r['stat']].append(r)

    breakdown = {}
    for stat, bets in by_stat.items():
        clvs = [b['clv'] for b in bets]
        breakdown[stat] = {
            'count': len(bets),
            'avg_clv': float(np.mean(clvs)),
            'clv_positive_rate': sum(1 for c in clvs if c > 0) / len(clvs),
            'hit_rate': sum(1 for b in bets if b['won']) / len(bets),
        }
    return breakdown


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
