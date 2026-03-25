"""
Market Projection Comparison

Compares model projections against market consensus (Unabated/Stokastic-style)
to spot inefficiencies fast. Identifies where your model disagrees with the
market and tracks which disagreements produce profitable edges.

Usage:
    comparator = MarketComparator()
    inefficiencies = comparator.find_inefficiencies(
        model_projections=my_projections,
        market_projections=market_data,
        min_disagreement=1.5
    )
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
import numpy as np
import pandas as pd


@dataclass
class MarketDisagreement:
    """A single point where model disagrees with market consensus."""
    player_id: int
    player_name: str
    stat_type: str
    game_date: str
    opponent: str

    model_projection: float
    market_projection: float
    line: float

    # Derived
    model_vs_market_diff: float  # model - market
    model_vs_line_diff: float    # model - line
    market_vs_line_diff: float   # market - line

    # Direction signals
    model_side: str     # "OVER" or "UNDER"
    market_side: str    # "OVER" or "UNDER"
    sides_agree: bool   # Do model and market agree on direction?

    # Edge metrics
    model_edge_pct: float  # How far model is from the line (%)
    inefficiency_score: float  # Composite score for ranking

    # Post-game (filled after game completes)
    actual_value: Optional[float] = None
    model_correct: Optional[bool] = None
    market_correct: Optional[bool] = None


@dataclass
class ComparisonReport:
    """Aggregate report of model vs market comparison."""
    total_props: int
    disagreements: int
    agreement_rate: float

    # Efficiency metrics
    avg_model_edge: float
    avg_market_edge: float
    model_closer_to_actual_rate: float  # How often model is closer to actual

    # By stat type
    by_stat: Dict[str, Dict]

    # Top inefficiencies
    top_inefficiencies: List[MarketDisagreement]

    # When model & market disagree, who wins?
    disagreement_model_win_rate: float
    disagreement_market_win_rate: float


class MarketComparator:
    """
    Compare model projections against market consensus to find inefficiencies.

    Market projections come from tools like Unabated, Stokastic, FantasyLabs,
    or aggregated sportsbook consensus (median line across books).
    """

    def __init__(
        self,
        min_disagreement_pct: float = 3.0,
        min_line_edge_pct: float = 2.0,
    ):
        """
        Args:
            min_disagreement_pct: Minimum % difference between model and market
                                  to flag as a disagreement
            min_line_edge_pct: Minimum % edge over the line to flag as playable
        """
        self.min_disagreement_pct = min_disagreement_pct
        self.min_line_edge_pct = min_line_edge_pct

    def find_inefficiencies(
        self,
        model_projections: pd.DataFrame,
        market_projections: pd.DataFrame,
        lines: Optional[pd.DataFrame] = None,
    ) -> List[MarketDisagreement]:
        """
        Find props where model disagrees with market consensus.

        Args:
            model_projections: DataFrame with columns:
                - player_id, player_name, stat_type, game_date, opponent,
                  projected_value
            market_projections: DataFrame with columns:
                - player_id, stat_type, game_date, market_value
                  (can also include 'source' for which tool)
            lines: Optional DataFrame with:
                - player_id, stat_type, game_date, line

        Returns:
            List of MarketDisagreement sorted by inefficiency score
        """
        merged = pd.merge(
            model_projections,
            market_projections,
            on=['player_id', 'stat_type', 'game_date'],
            suffixes=('_model', '_market')
        )

        if lines is not None:
            merged = pd.merge(
                merged, lines,
                on=['player_id', 'stat_type', 'game_date'],
                how='left'
            )

        disagreements = []

        for _, row in merged.iterrows():
            model_val = row['projected_value']
            market_val = row['market_value']
            line = row.get('line', None)

            if pd.isna(model_val) or pd.isna(market_val):
                continue
            if model_val == 0 and market_val == 0:
                continue

            # Calculate difference as percentage of the line or market value
            base = line if (line and not pd.isna(line)) else market_val
            if base == 0:
                continue

            diff = model_val - market_val
            diff_pct = abs(diff / base) * 100

            if diff_pct < self.min_disagreement_pct:
                continue

            # Determine sides relative to line
            if line and not pd.isna(line):
                model_side = "OVER" if model_val > line else "UNDER"
                market_side = "OVER" if market_val > line else "UNDER"
                model_vs_line = model_val - line
                market_vs_line = market_val - line
                model_edge_pct = abs(model_vs_line / line) * 100
            else:
                model_side = "OVER" if diff > 0 else "UNDER"
                market_side = "UNDER" if diff > 0 else "OVER"
                model_vs_line = 0
                market_vs_line = 0
                model_edge_pct = diff_pct

            # Inefficiency score: higher = more interesting
            # Weights: disagreement size, edge over line, confidence
            inefficiency = diff_pct * 0.6 + model_edge_pct * 0.4

            disagreements.append(MarketDisagreement(
                player_id=int(row['player_id']),
                player_name=row.get('player_name', str(row['player_id'])),
                stat_type=row['stat_type'],
                game_date=str(row['game_date']),
                opponent=row.get('opponent', ''),
                model_projection=float(model_val),
                market_projection=float(market_val),
                line=float(line) if (line and not pd.isna(line)) else 0.0,
                model_vs_market_diff=float(diff),
                model_vs_line_diff=float(model_vs_line),
                market_vs_line_diff=float(market_vs_line),
                model_side=model_side,
                market_side=market_side,
                sides_agree=model_side == market_side,
                model_edge_pct=model_edge_pct,
                inefficiency_score=inefficiency,
            ))

        return sorted(disagreements, key=lambda x: x.inefficiency_score, reverse=True)

    def generate_report(
        self,
        model_projections: pd.DataFrame,
        market_projections: pd.DataFrame,
        actuals: Optional[pd.DataFrame] = None,
        lines: Optional[pd.DataFrame] = None,
    ) -> ComparisonReport:
        """
        Generate a full comparison report with accuracy tracking.

        Args:
            actuals: Optional DataFrame with:
                - player_id, stat_type, game_date, actual_value
        """
        disagreements = self.find_inefficiencies(
            model_projections, market_projections, lines
        )

        # Merge all data for accuracy analysis
        merged = pd.merge(
            model_projections, market_projections,
            on=['player_id', 'stat_type', 'game_date'],
            suffixes=('_model', '_market')
        )
        if lines is not None:
            merged = pd.merge(
                merged, lines,
                on=['player_id', 'stat_type', 'game_date'],
                how='left'
            )

        total_props = len(merged)

        # If we have actuals, compute accuracy
        model_closer = 0
        model_wins_on_disagree = 0
        market_wins_on_disagree = 0
        disagree_with_actuals = 0

        if actuals is not None and not actuals.empty:
            merged = pd.merge(
                merged, actuals,
                on=['player_id', 'stat_type', 'game_date'],
                how='left'
            )

            has_actual = merged['actual_value'].notna()
            actual_rows = merged[has_actual]

            for _, row in actual_rows.iterrows():
                actual = row['actual_value']
                model_err = abs(row['projected_value'] - actual)
                market_err = abs(row['market_value'] - actual)

                if model_err < market_err:
                    model_closer += 1

            # Evaluate disagreements with actuals
            for d in disagreements:
                actual_row = actuals[
                    (actuals['player_id'] == d.player_id) &
                    (actuals['stat_type'] == d.stat_type) &
                    (actuals['game_date'] == d.game_date)
                ]
                if actual_row.empty:
                    continue

                actual_val = float(actual_row.iloc[0]['actual_value'])
                d.actual_value = actual_val

                line = d.line if d.line > 0 else d.market_projection
                d.model_correct = (
                    (d.model_side == "OVER" and actual_val > line) or
                    (d.model_side == "UNDER" and actual_val < line)
                )
                d.market_correct = (
                    (d.market_side == "OVER" and actual_val > line) or
                    (d.market_side == "UNDER" and actual_val < line)
                )

                if not d.sides_agree:
                    disagree_with_actuals += 1
                    if d.model_correct:
                        model_wins_on_disagree += 1
                    if d.market_correct:
                        market_wins_on_disagree += 1

            model_closer_rate = model_closer / len(actual_rows) if len(actual_rows) > 0 else 0
        else:
            model_closer_rate = 0

        # By stat breakdown
        by_stat = defaultdict(lambda: {
            'total': 0, 'disagreements': 0,
            'avg_diff': 0, 'diffs': [],
        })
        for d in disagreements:
            by_stat[d.stat_type]['disagreements'] += 1
            by_stat[d.stat_type]['diffs'].append(d.model_vs_market_diff)

        for _, row in merged.iterrows():
            stat = row['stat_type']
            by_stat[stat]['total'] += 1

        for stat in by_stat:
            data = by_stat[stat]
            if data['diffs']:
                data['avg_diff'] = float(np.mean(data['diffs']))
            del data['diffs']

        # Model & market avg edge
        avg_model_edge = float(np.mean([d.model_edge_pct for d in disagreements])) if disagreements else 0
        avg_market_edge = 0  # Market is the consensus, edge is 0 by definition

        return ComparisonReport(
            total_props=total_props,
            disagreements=len(disagreements),
            agreement_rate=1 - (len(disagreements) / total_props) if total_props > 0 else 1.0,
            avg_model_edge=avg_model_edge,
            avg_market_edge=avg_market_edge,
            model_closer_to_actual_rate=model_closer_rate,
            by_stat=dict(by_stat),
            top_inefficiencies=disagreements[:20],
            disagreement_model_win_rate=(
                model_wins_on_disagree / disagree_with_actuals
                if disagree_with_actuals > 0 else 0
            ),
            disagreement_market_win_rate=(
                market_wins_on_disagree / disagree_with_actuals
                if disagree_with_actuals > 0 else 0
            ),
        )

    def build_market_consensus(
        self,
        multi_book_lines: pd.DataFrame,
    ) -> pd.DataFrame:
        """
        Build market consensus projections from multiple sportsbook lines.

        Uses the median line across all sportsbooks as the market projection.
        This is the "Unabated-style" approach — the market IS the consensus.

        Args:
            multi_book_lines: DataFrame with:
                - player_id, stat_type, game_date, sportsbook, line

        Returns:
            DataFrame with player_id, stat_type, game_date, market_value,
            num_books, line_spread (max - min across books)
        """
        grouped = multi_book_lines.groupby(['player_id', 'stat_type', 'game_date'])

        rows = []
        for (pid, stat, date), group in grouped:
            lines = group['line'].dropna()
            if len(lines) == 0:
                continue

            rows.append({
                'player_id': pid,
                'stat_type': stat,
                'game_date': date,
                'market_value': float(lines.median()),
                'market_mean': float(lines.mean()),
                'num_books': len(lines),
                'line_spread': float(lines.max() - lines.min()),
                'lowest_line': float(lines.min()),
                'highest_line': float(lines.max()),
            })

        return pd.DataFrame(rows)
