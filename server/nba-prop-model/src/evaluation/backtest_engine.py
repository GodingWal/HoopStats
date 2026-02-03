"""
Signal Backtest Engine

Validates signal accuracy against historical data from the database.
Loads completed games, reconstructs pre-game context, calculates what
each signal would have predicted, and compares to actual outcomes.
"""

from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from collections import defaultdict
import logging
import json

logger = logging.getLogger(__name__)


@dataclass
class SignalAccuracy:
    """Accuracy metrics for a single signal."""
    signal_name: str
    stat_type: str
    total_predictions: int = 0
    correct_predictions: int = 0
    over_predictions: int = 0
    over_correct: int = 0
    under_predictions: int = 0
    under_correct: int = 0
    total_error: float = 0.0
    error_when_wrong: float = 0.0

    @property
    def accuracy(self) -> float:
        if self.total_predictions == 0:
            return 0.0
        return self.correct_predictions / self.total_predictions

    @property
    def over_accuracy(self) -> float:
        if self.over_predictions == 0:
            return 0.0
        return self.over_correct / self.over_predictions

    @property
    def under_accuracy(self) -> float:
        if self.under_predictions == 0:
            return 0.0
        return self.under_correct / self.under_predictions

    @property
    def avg_error(self) -> float:
        if self.total_predictions == 0:
            return 0.0
        return self.total_error / self.total_predictions

    @property
    def grade(self) -> str:
        """Grade the signal based on accuracy."""
        acc = self.accuracy
        if acc >= 0.65:
            return "HIGH"
        elif acc >= 0.55:
            return "MEDIUM"
        elif acc >= 0.52:
            return "LOW"
        else:
            return "NOISE"

    def to_dict(self) -> Dict[str, Any]:
        return {
            'signal_name': self.signal_name,
            'stat_type': self.stat_type,
            'total_predictions': self.total_predictions,
            'correct_predictions': self.correct_predictions,
            'accuracy': self.accuracy,
            'over_predictions': self.over_predictions,
            'over_correct': self.over_correct,
            'over_accuracy': self.over_accuracy,
            'under_predictions': self.under_predictions,
            'under_correct': self.under_correct,
            'under_accuracy': self.under_accuracy,
            'avg_error': self.avg_error,
            'grade': self.grade,
        }


@dataclass
class BacktestResults:
    """Results from a backtest run."""
    stat_type: str
    days_evaluated: int
    start_date: str
    end_date: str
    total_games: int
    signal_accuracy: Dict[str, SignalAccuracy] = field(default_factory=dict)
    overall_accuracy: float = 0.0

    def get_summary_table(self) -> str:
        """Generate formatted summary table."""
        lines = [
            f"\nSIGNAL ACCURACY REPORT - {self.stat_type}",
            "=" * 70,
            f"Period: {self.start_date} to {self.end_date} ({self.days_evaluated} days)",
            f"Total Games Evaluated: {self.total_games}",
            "=" * 70,
            f"{'Signal':<18} {'N':>8} {'Acc%':>8} {'Over':>12} {'Under':>12} {'Grade':<10}",
            "-" * 70,
        ]

        # Sort by accuracy descending
        sorted_signals = sorted(
            self.signal_accuracy.values(),
            key=lambda x: x.accuracy,
            reverse=True
        )

        for sa in sorted_signals:
            over_str = f"{sa.over_correct}/{sa.over_predictions}" if sa.over_predictions > 0 else "-"
            under_str = f"{sa.under_correct}/{sa.under_predictions}" if sa.under_predictions > 0 else "-"

            grade_emoji = {
                'HIGH': '✅',
                'MEDIUM': '🟡',
                'LOW': '🟠',
                'NOISE': '❌'
            }.get(sa.grade, '')

            lines.append(
                f"{sa.signal_name:<18} {sa.total_predictions:>8} "
                f"{sa.accuracy*100:>7.1f}% {over_str:>12} {under_str:>12} "
                f"{grade_emoji} {sa.grade:<10}"
            )

        lines.append("=" * 70)
        return "\n".join(lines)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'stat_type': self.stat_type,
            'days_evaluated': self.days_evaluated,
            'start_date': self.start_date,
            'end_date': self.end_date,
            'total_games': self.total_games,
            'overall_accuracy': self.overall_accuracy,
            'signal_accuracy': {
                name: sa.to_dict()
                for name, sa in self.signal_accuracy.items()
            }
        }


class BacktestEngine:
    """
    Validates signal accuracy against historical data.

    Can operate in two modes:
    1. Database mode: Load from PostgreSQL (prizepicks_daily_lines, players tables)
    2. DataFrame mode: Accept pre-loaded pandas DataFrames

    For each completed game:
    1. Reconstruct pre-game context from stored data
    2. Calculate what each signal WOULD have predicted
    3. Compare predicted direction to actual outcome
    4. Track accuracy per signal
    """

    def __init__(self, db_connection=None):
        """
        Initialize backtest engine.

        Args:
            db_connection: Optional database connection for loading data
        """
        self.db_connection = db_connection
        self._signal_registry = None

    @property
    def signal_registry(self):
        """Lazy load signal registry to avoid circular imports."""
        if self._signal_registry is None:
            from ..signals import registry
            self._signal_registry = registry
        return self._signal_registry

    def run(
        self,
        days: int,
        stat_type: str,
        end_date: Optional[str] = None,
        games_df=None,
        players_df=None,
    ) -> BacktestResults:
        """
        Run backtest for a specific stat type over N days.

        Args:
            days: Number of days to look back
            stat_type: Stat type to evaluate ('Points', 'Rebounds', 'Assists')
            end_date: End date for backtest (defaults to yesterday)
            games_df: Optional DataFrame of games (for testing without DB)
            players_df: Optional DataFrame of players (for testing without DB)

        Returns:
            BacktestResults with accuracy metrics per signal
        """
        # Calculate date range
        if end_date is None:
            end_dt = datetime.now() - timedelta(days=1)
        else:
            end_dt = datetime.strptime(end_date, '%Y-%m-%d')

        start_dt = end_dt - timedelta(days=days)
        start_date = start_dt.strftime('%Y-%m-%d')
        end_date_str = end_dt.strftime('%Y-%m-%d')

        # Load completed games
        if games_df is not None:
            games = self._filter_games_df(games_df, start_date, end_date_str, stat_type)
        else:
            games = self._load_completed_games(start_date, end_date_str, stat_type)

        if not games:
            logger.warning(f"No completed games found for {stat_type} between {start_date} and {end_date_str}")
            return BacktestResults(
                stat_type=stat_type,
                days_evaluated=days,
                start_date=start_date,
                end_date=end_date_str,
                total_games=0,
            )

        # Initialize accuracy trackers
        signal_accuracy: Dict[str, SignalAccuracy] = {}
        for signal_name in self.signal_registry.list_signals_for_stat(stat_type):
            signal_accuracy[signal_name] = SignalAccuracy(
                signal_name=signal_name,
                stat_type=stat_type,
            )

        # Evaluate each game
        for game in games:
            context = self._build_context(game, players_df)
            self._evaluate_game(game, context, stat_type, signal_accuracy)

        # Calculate overall accuracy
        total_correct = sum(sa.correct_predictions for sa in signal_accuracy.values())
        total_preds = sum(sa.total_predictions for sa in signal_accuracy.values())
        overall_accuracy = total_correct / total_preds if total_preds > 0 else 0.0

        return BacktestResults(
            stat_type=stat_type,
            days_evaluated=days,
            start_date=start_date,
            end_date=end_date_str,
            total_games=len(games),
            signal_accuracy=signal_accuracy,
            overall_accuracy=overall_accuracy,
        )

    def _load_completed_games(
        self,
        start_date: str,
        end_date: str,
        stat_type: str
    ) -> List[Dict]:
        """
        Load completed games with actuals from database.

        Queries prizepicks_daily_lines joined with players table.
        Only returns games where actual_value IS NOT NULL.
        """
        if self.db_connection is None:
            logger.warning("No database connection - returning empty list")
            return []

        query = """
            SELECT
                pdl.player_name,
                pdl.team,
                pdl.stat_type,
                pdl.game_date,
                pdl.opening_line as line,
                pdl.actual_value,
                pdl.hit_over,
                pdl.opponent,
                p.season_averages,
                p.last_5_averages,
                p.last_10_averages,
                p.home_averages,
                p.away_averages,
                p.position,
                p.recent_games
            FROM prizepicks_daily_lines pdl
            LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
            WHERE pdl.game_date >= %s
              AND pdl.game_date <= %s
              AND pdl.stat_type = %s
              AND pdl.actual_value IS NOT NULL
            ORDER BY pdl.game_date
        """

        try:
            cursor = self.db_connection.cursor()
            cursor.execute(query, (start_date, end_date, stat_type))
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            cursor.close()

            return [dict(zip(columns, row)) for row in rows]
        except Exception as e:
            logger.error(f"Error loading games: {e}")
            return []

    def _filter_games_df(
        self,
        df,
        start_date: str,
        end_date: str,
        stat_type: str
    ) -> List[Dict]:
        """Filter DataFrame to completed games in date range."""
        import pandas as pd

        # Convert dates
        df['game_date'] = pd.to_datetime(df['game_date'])
        start_dt = pd.to_datetime(start_date)
        end_dt = pd.to_datetime(end_date)

        # Filter
        mask = (
            (df['game_date'] >= start_dt) &
            (df['game_date'] <= end_dt) &
            (df['stat_type'] == stat_type) &
            (df['actual_value'].notna())
        )

        filtered = df[mask].copy()
        filtered['game_date'] = filtered['game_date'].dt.strftime('%Y-%m-%d')

        return filtered.to_dict('records')

    def _build_context(self, game: Dict, players_df=None) -> Dict[str, Any]:
        """
        Build pre-game context from stored data.

        Reconstructs the context dictionary needed by signals:
        - Calculate is_b2b from schedule (if available)
        - Pull player averages from players table
        - Pull opponent data if available
        """
        context = {
            'player_name': game.get('player_name', ''),
            'team': game.get('team', ''),
            'opponent': game.get('opponent', ''),
            'game_date': game.get('game_date', ''),
        }

        # Parse JSON fields if stored as strings
        season_avgs = game.get('season_averages', {})
        if isinstance(season_avgs, str):
            try:
                season_avgs = json.loads(season_avgs)
            except:
                season_avgs = {}

        l5_avgs = game.get('last_5_averages', {})
        if isinstance(l5_avgs, str):
            try:
                l5_avgs = json.loads(l5_avgs)
            except:
                l5_avgs = {}

        l10_avgs = game.get('last_10_averages', {})
        if isinstance(l10_avgs, str):
            try:
                l10_avgs = json.loads(l10_avgs)
            except:
                l10_avgs = {}

        home_avgs = game.get('home_averages', {})
        if isinstance(home_avgs, str):
            try:
                home_avgs = json.loads(home_avgs)
            except:
                home_avgs = {}

        away_avgs = game.get('away_averages', {})
        if isinstance(away_avgs, str):
            try:
                away_avgs = json.loads(away_avgs)
            except:
                away_avgs = {}

        context['season_averages'] = season_avgs
        context['last_5_averages'] = l5_avgs
        context['last_10_averages'] = l10_avgs
        context['home_averages'] = home_avgs
        context['away_averages'] = away_avgs

        # Position
        position = game.get('position', '')
        if position:
            context['player_position'] = position

        # Detect home/away from opponent field format
        # Common formats: "@ BOS" (away), "vs BOS" or just "BOS" (home)
        opponent = game.get('opponent', '')
        opponent_clean = opponent.strip() if opponent else ''
        
        if opponent_clean.startswith('@'):
            context['is_home'] = False
            opponent_clean = opponent_clean[1:].strip()
        elif opponent_clean.lower().startswith('vs'):
            context['is_home'] = True
            opponent_clean = opponent_clean[2:].strip()
        else:
            # Default to home if no prefix (common for home games)
            context['is_home'] = True

        # Set opponent team for defense lookup
        if opponent_clean:
            context['opponent_team'] = opponent_clean
            context['opponent'] = opponent_clean

        # B2B detection - check if team played on previous day
        context['is_b2b'] = self._detect_b2b(game)

        return context

    def _detect_b2b(self, game: Dict) -> bool:
        """
        Detect if this game is a back-to-back by checking if the team
        played on the previous day.
        """
        if self.db_connection is None:
            return False

        team = game.get('team', '')
        game_date = game.get('game_date', '')
        
        if not team or not game_date:
            return False

        try:
            # Handle both string and date objects
            if isinstance(game_date, str):
                from datetime import datetime
                game_dt = datetime.strptime(game_date, '%Y-%m-%d')
            else:
                game_dt = game_date
            
            prev_date = (game_dt - timedelta(days=1)).strftime('%Y-%m-%d')

            cursor = self.db_connection.cursor()
            cursor.execute("""
                SELECT COUNT(*) FROM prizepicks_daily_lines
                WHERE team = %s AND game_date = %s
                LIMIT 1
            """, (team, prev_date))
            
            result = cursor.fetchone()
            cursor.close()
            
            return result and result[0] > 0
        except Exception as e:
            logger.debug(f"B2B detection failed: {e}")
            return False

    def _evaluate_game(
        self,
        game: Dict,
        context: Dict[str, Any],
        stat_type: str,
        signal_accuracy: Dict[str, SignalAccuracy]
    ) -> None:
        """
        Evaluate all signals for a single game.

        For each signal:
        1. Calculate what it would have predicted
        2. Compare to actual outcome (over/under line)
        3. Update accuracy tracking
        """
        line = game.get('line') or game.get('opening_line')
        actual = game.get('actual_value')

        if line is None or actual is None:
            return

        # Determine actual outcome
        actual_hit_over = actual > line

        # Calculate all signals
        results = self.signal_registry.calculate_all(
            player_id=game.get('player_id', ''),
            game_date=game.get('game_date', ''),
            stat_type=stat_type,
            context=context,
        )

        # Evaluate each signal
        for signal_name, result in results.items():
            if signal_name not in signal_accuracy:
                continue

            sa = signal_accuracy[signal_name]

            # Only count signals that fired
            if not result.fired:
                continue

            sa.total_predictions += 1

            # Track direction prediction
            predicted_over = result.direction == 'OVER'
            predicted_under = result.direction == 'UNDER'

            if predicted_over:
                sa.over_predictions += 1
                if actual_hit_over:
                    sa.over_correct += 1
                    sa.correct_predictions += 1
            elif predicted_under:
                sa.under_predictions += 1
                if not actual_hit_over:
                    sa.under_correct += 1
                    sa.correct_predictions += 1

            # Track error: distance between actual and line adjusted by signal
            # This measures how far off the signal-adjusted value was from actual
            signal_projected = line + result.adjustment
            error = abs(actual - signal_projected)
            sa.total_error += error

    def save_to_db(self, results: BacktestResults) -> bool:
        """
        Save backtest results to database.

        Inserts into signal_performance and backtest_runs tables.
        """
        if self.db_connection is None:
            logger.warning("No database connection - cannot save results")
            return False

        try:
            cursor = self.db_connection.cursor()

            # Insert into backtest_runs
            cursor.execute("""
                INSERT INTO backtest_runs (
                    stat_type, days_evaluated, start_date, end_date,
                    total_predictions, correct_predictions, overall_accuracy,
                    signal_breakdown, run_completed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            """, (
                results.stat_type,
                results.days_evaluated,
                results.start_date,
                results.end_date,
                results.total_games,
                int(results.overall_accuracy * results.total_games),
                results.overall_accuracy,
                json.dumps({
                    name: {'n': sa.total_predictions, 'accuracy': sa.accuracy}
                    for name, sa in results.signal_accuracy.items()
                }),
            ))

            # Insert into signal_performance
            for signal_name, sa in results.signal_accuracy.items():
                cursor.execute("""
                    INSERT INTO signal_performance (
                        signal_name, stat_type, evaluation_date,
                        predictions_made, correct_predictions, accuracy,
                        over_predictions, over_correct,
                        under_predictions, under_correct,
                        avg_error, min_sample_met
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (signal_name, stat_type, evaluation_date)
                    DO UPDATE SET
                        predictions_made = EXCLUDED.predictions_made,
                        correct_predictions = EXCLUDED.correct_predictions,
                        accuracy = EXCLUDED.accuracy,
                        over_predictions = EXCLUDED.over_predictions,
                        over_correct = EXCLUDED.over_correct,
                        under_predictions = EXCLUDED.under_predictions,
                        under_correct = EXCLUDED.under_correct,
                        avg_error = EXCLUDED.avg_error,
                        min_sample_met = EXCLUDED.min_sample_met,
                        calculated_at = NOW()
                """, (
                    sa.signal_name,
                    sa.stat_type,
                    results.end_date,
                    sa.total_predictions,
                    sa.correct_predictions,
                    sa.accuracy,
                    sa.over_predictions,
                    sa.over_correct,
                    sa.under_predictions,
                    sa.under_correct,
                    sa.avg_error,
                    sa.total_predictions >= 10,
                ))

            self.db_connection.commit()
            cursor.close()
            return True

        except Exception as e:
            logger.error(f"Error saving backtest results: {e}")
            self.db_connection.rollback()
            return False


def run_full_backtest(
    db_connection=None,
    days: int = 30,
    stat_types: List[str] = None
) -> Dict[str, BacktestResults]:
    """
    Run backtest for all stat types.

    Args:
        db_connection: Database connection
        days: Number of days to backtest
        stat_types: List of stat types (defaults to all)

    Returns:
        Dict mapping stat type to BacktestResults
    """
    if stat_types is None:
        stat_types = ['Points', 'Rebounds', 'Assists']

    engine = BacktestEngine(db_connection)
    results = {}

    for stat_type in stat_types:
        logger.info(f"Running backtest for {stat_type}...")
        results[stat_type] = engine.run(days=days, stat_type=stat_type)

        # Print summary
        print(results[stat_type].get_summary_table())

    return results
