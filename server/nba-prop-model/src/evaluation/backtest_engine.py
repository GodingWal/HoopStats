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
import pandas as pd
import unicodedata

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
        self.team_stats = {}
        self.game_referees = {}  # {game_id: [ref_names]}
        self.line_history = {}   # {(player, stat, date): [movements]}
        self.injury_data = {}    # {(team, date): [injured_player_names]}
        self.team_rosters = {}   # {team: [player_names_with_positions]}
        self._signal_registry = None

        if self.db_connection:
            self._load_team_stats()
            self._load_referees()
            self._load_line_history()
            self._load_injuries()
            self._load_team_rosters()

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

        try:

            cursor = self.db_connection.cursor()
            
            # 1. Get Games
            game_query = """
                SELECT
                    player_name,
                    team,
                    stat_type,
                    game_date,
                    opening_line,
                    closing_line,
                    opening_line as line,
                    actual_value,
                    hit_over,
                    opponent
                FROM prizepicks_daily_lines
                WHERE game_date >= %s
                  AND game_date <= %s
                  AND stat_type = %s
                  AND actual_value IS NOT NULL
                ORDER BY game_date
            """
            cursor.execute(game_query, (start_date, end_date, stat_type))
            game_cols = [desc[0] for desc in cursor.description]
            games = [dict(zip(game_cols, row)) for row in cursor.fetchall()]
            
            if not games:
                cursor.close()
                return []
                
            # 2. Get All Players for lookup
            player_query = """
                SELECT 
                    player_name,
                    season_averages,
                    last_5_averages,
                    last_10_averages,
                    home_averages,
                    away_averages,
                    position,
                    recent_games
                FROM players
            """
            cursor.execute(player_query)
            player_cols = [desc[0] for desc in cursor.description]
            players = [dict(zip(player_cols, row)) for row in cursor.fetchall()]
            cursor.close()
            
            # 3. Build lookup map with normalized names
            def normalize(name):
                if not name: return ""
                # Strip accents and lowercase
                return ''.join(c for c in unicodedata.normalize('NFD', name)
                              if unicodedata.category(c) != 'Mn').lower().replace('.', '').strip()

            player_map = {}
            for p in players:
                # Map both raw and normalized name
                p_name = p.get('player_name') or ""
                player_map[p_name.lower()] = p
                player_map[normalize(p_name)] = p
                
            # 4. Join data
            joined_games = []
            for game in games:
                p_name = game.get('player_name') or ""
                
                # Try exact/lower match first
                player_data = player_map.get(p_name.lower())
                
                # Try normalized match if failed
                if not player_data:
                    player_data = player_map.get(normalize(p_name))
                    
                if player_data:
                    # Merge player data into game dict
                    game.update(player_data)
                
                joined_games.append(game)

            return joined_games
            
        except Exception as e:
            logger.error(f"Error loading games with fuzzy match: {e}")
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

    def _load_team_stats(self):
        """Load team defense stats from database."""
        if self.db_connection is None:
            return

        try:
            df = pd.read_sql("SELECT * FROM team_defense", self.db_connection)
            # Create a lookup dict by team_abbr
            # Structure: {'BOS': {'pace': 98.5, 'def_rating': 110.2, ...}}
            for _, row in df.iterrows():
                abbr = row['team_abbr']
                self.team_stats[abbr] = {
                    'pace': row['pace'],
                    'def_rating': row['def_rating'],
                    'opp_pts': row['opp_pts_allowed'],
                    'opp_reb': row['opp_reb_allowed'],
                    'opp_ast': row['opp_ast_allowed'],
                    'opp_3pt': row['opp_3pt_pct_allowed']
                }
            
            # Compute league averages
            self.league_averages = {
                'pts': df['opp_pts_allowed'].mean(),
                'reb': df['opp_reb_allowed'].mean(),
                'ast': df['opp_ast_allowed'].mean(),
                '3pt_pct': df['opp_3pt_pct_allowed'].mean()
            }
            logger.info(f"Loaded defense stats for {len(self.team_stats)} teams. League Avgs: {self.league_averages}")

        except Exception as e:
            logger.error(f"Failed to load team stats: {e}")
            self.league_averages = {'pts': 114.5, 'reb': 44.0, 'ast': 26.5, '3pt_pct': 0.366}

    def _load_referees(self):
        """Load referee assignments and game mapping."""
        if self.db_connection is None:
            return

        try:
            # 1. Load Game Mapping (Team + Date -> GameID)
            self.game_map = {} # (team, date) -> game_id
            games_df = pd.read_sql("SELECT game_id, game_date, home_team, visitor_team FROM games", self.db_connection)
            for _, row in games_df.iterrows():
                gid = row['game_id']
                date_str = str(row['game_date'])
                self.game_map[(row['home_team'], date_str)] = gid
                self.game_map[(row['visitor_team'], date_str)] = gid

            # 2. Load Referees
            df = pd.read_sql("""
                SELECT gr.game_id, r.first_name || ' ' || r.last_name as name
                FROM game_referees gr
                JOIN referees r ON gr.referee_id = r.id
            """, self.db_connection)
            
            for _, row in df.iterrows():
                gid = row['game_id']
                if gid not in self.game_referees:
                    self.game_referees[gid] = []
                self.game_referees[gid].append(row['name'])
            
            logger.info(f"Loaded referees for {len(self.game_referees)} games")
        except Exception as e:
            logger.error(f"Failed to load referees: {e}")
            if hasattr(self.db_connection, 'rollback'):
                self.db_connection.rollback()

    def _load_line_history(self):
        """Load line movement history."""
        if self.db_connection is None:
            return

        try:
            logger.info("Loading line movement history...")
            df = pd.read_sql("""
                SELECT player_name, stat_type, game_time::date::text as game_date, 
                       new_line as line, detected_at as timestamp
                FROM prizepicks_line_movements
                WHERE detected_at >= NOW() - INTERVAL '60 days'
            """, self.db_connection)
            
            self.line_history = {}
            count = 0
            for _, row in df.iterrows():
                key = (row['player_name'], row['stat_type'], row['game_date'])
                if key not in self.line_history:
                    self.line_history[key] = []
                self.line_history[key].append({
                    'line': row['line'],
                    'timestamp': row['timestamp']
                })
                count += 1
            
            logger.info(f"Loaded {count} line checks for history")
        except Exception as e:
            logger.error(f"Failed to load line history: {e}")
            if hasattr(self.db_connection, 'rollback'):
                self.db_connection.rollback()

    def _load_injuries(self):
        """Load injury history to find players OUT on specific dates."""
        if self.db_connection is None:
            return

        try:
            # Load significant injury status changes (player marked OUT)
            # Use injury_history to reconstruct who was out on each date
            df = pd.read_sql("""
                SELECT player_name, team, new_status, detected_at::date as status_date
                FROM injury_history
                WHERE new_status IN ('out', 'doubtful')
                  AND detected_at >= NOW() - INTERVAL '90 days'
                ORDER BY detected_at
            """, self.db_connection)

            # Build lookup: (team, date) -> list of injured player names
            self.injury_data = {}
            for _, row in df.iterrows():
                team = row['team']
                date_str = str(row['status_date'])
                key = (team, date_str)
                if key not in self.injury_data:
                    self.injury_data[key] = []
                name = row['player_name']
                if name not in self.injury_data[key]:
                    self.injury_data[key].append(name)

            logger.info(f"Loaded injury data for {len(self.injury_data)} team-dates")
        except Exception as e:
            logger.error(f"Failed to load injuries: {e}")
            if hasattr(self.db_connection, 'rollback'):
                self.db_connection.rollback()

    def _load_team_rosters(self):
        """Load team rosters with positions for defender matchup heuristics."""
        if self.db_connection is None:
            return

        try:
            df = pd.read_sql("""
                SELECT player_name, team, position
                FROM players
                WHERE team IS NOT NULL AND position IS NOT NULL
            """, self.db_connection)

            self.team_rosters = {}
            for _, row in df.iterrows():
                team = row['team']
                if team not in self.team_rosters:
                    self.team_rosters[team] = []
                self.team_rosters[team].append({
                    'name': row['player_name'],
                    'position': row['position'],
                })

            logger.info(f"Loaded rosters for {len(self.team_rosters)} teams")
        except Exception as e:
            logger.error(f"Failed to load team rosters: {e}")
            if hasattr(self.db_connection, 'rollback'):
                self.db_connection.rollback()

    def _find_injured_teammates(self, team: str, game_date: str) -> List[str]:
        """Find teammates who were OUT on or near the game date."""
        # Check exact date and day before (injury reported day before game)
        injured = set()
        for offset in range(0, 3):  # Check game day, day before, 2 days before
            try:
                if isinstance(game_date, str):
                    dt = datetime.strptime(game_date, '%Y-%m-%d')
                else:
                    dt = game_date
                check_date = (dt - timedelta(days=offset)).strftime('%Y-%m-%d')
                key = (team, check_date)
                if key in self.injury_data:
                    injured.update(self.injury_data[key])
            except (ValueError, TypeError):
                pass
        return list(injured)

    def _find_primary_defender(self, opponent_team: str, player_position: str) -> Optional[str]:
        """
        Heuristic: find a known elite/weak defender on the opponent team
        whose position matches the player.
        """
        # Import known defenders from the signal
        from ..signals.defender_matchup import DefenderMatchupSignal
        known_defenders = {}
        known_defenders.update(DefenderMatchupSignal.ELITE_DEFENDERS)
        known_defenders.update(DefenderMatchupSignal.WEAK_DEFENDERS)

        roster = self.team_rosters.get(opponent_team, [])
        if not roster:
            return None

        # Normalize player position to G/F/C
        pos = (player_position or '').upper()
        if not pos:
            return None
        pos_category = pos[0] if pos else ''  # G, F, or C

        for player in roster:
            name = player['name']
            if name in known_defenders:
                defender_pos = known_defenders[name].get('position', '')
                # Match position category (G vs G, F vs F, C vs C)
                if defender_pos and defender_pos[0] == pos_category:
                    return name

        return None

    def _estimate_spread(self, team: str, opponent: str, is_home: bool) -> Optional[float]:
        """
        Estimate game spread from team defensive ratings.
        Positive = underdog, Negative = favorite.
        Returns the spread from the player's team perspective.
        """
        team_stats = self.team_stats.get(team)
        opp_stats = self.team_stats.get(opponent)

        if not team_stats or not opp_stats:
            return None

        # Use defensive rating differential as proxy for spread
        # Lower def_rating = better defense = likely favored
        team_def = team_stats.get('def_rating', 112)
        opp_def = opp_stats.get('def_rating', 112)

        # Net rating proxy: team with lower def_rating is better
        # Scale: 1 point of def_rating diff ≈ 0.5 points of spread
        rating_diff = (team_def - opp_def) * 0.5

        # Home court advantage: ~3 points
        if is_home:
            rating_diff -= 3.0
        else:
            rating_diff += 3.0

        return rating_diff

    def _extract_vs_team_history(self, game: Dict, opponent: str) -> List[Dict]:
        """
        Extract matchup history vs specific opponent from recent_games JSONB.
        """
        recent_games = game.get('recent_games') or []
        if isinstance(recent_games, str):
            try:
                recent_games = json.loads(recent_games)
            except (json.JSONDecodeError, TypeError):
                return []

        if not isinstance(recent_games, list):
            return []

        vs_games = []
        # Normalize opponent for matching
        opp_clean = opponent.strip().upper() if opponent else ''
        if not opp_clean:
            return []

        for g in recent_games:
            game_opp = (g.get('OPPONENT') or g.get('opponent') or '').strip().upper()
            # Handle formats like "@ BOS", "vs BOS", "BOS"
            game_opp_clean = game_opp.replace('@', '').replace('VS', '').strip()
            if game_opp_clean == opp_clean or opp_clean in game_opp_clean:
                vs_games.append(g)

        return vs_games

    def _build_context(self, game: Dict, players_df=None) -> Dict[str, Any]:
        """
        Build pre-game context from stored data.
        """
        team = game.get('team', '')
        game_date = str(game.get('game_date', ''))
        stat_type = game.get('stat_type', '')
        player_name = game.get('player_name', '')
        
        # Lookup game_id from custom map
        game_id = self.game_map.get((team, game_date))
        
        context = {
            'player_name': player_name,
            'team': team,
            'opponent': game.get('opponent', ''),
            'game_date': game_date,
            'stat_type': stat_type,
            'opening_line': game.get('opening_line') or game.get('line'),
            'current_line': game.get('closing_line') or game.get('line'),
            'closing_line': game.get('closing_line'),
            'referee_names': self.game_referees.get(game_id, []) if game_id else [],
            'line_history': self.line_history.get((player_name, stat_type, game_date), []),
        }

        # Parse JSON fields if stored as strings
        season_avgs = game.get('season_averages') or {}
        if isinstance(season_avgs, str):
            try:
                season_avgs = json.loads(season_avgs)
            except:
                season_avgs = {}

        l5_avgs = game.get('last_5_averages') or {}
        if isinstance(l5_avgs, str):
            try:
                l5_avgs = json.loads(l5_avgs)
            except:
                l5_avgs = {}

        l10_avgs = game.get('last_10_averages') or {}
        if isinstance(l10_avgs, str):
            try:
                l10_avgs = json.loads(l10_avgs)
            except:
                l10_avgs = {}

        home_avgs = game.get('home_averages') or {}
        if isinstance(home_avgs, str):
            try:
                home_avgs = json.loads(home_avgs)
            except:
                home_avgs = {}

        away_avgs = game.get('away_averages') or {}
        if isinstance(away_avgs, str):
            try:
                away_avgs = json.loads(away_avgs)
            except:
                away_avgs = {}

        # Helper to normalize keys
        def normalize_keys(d):
            if not d: return {}
            return {k.lower(): v for k, v in d.items()}

        context['season_averages'] = normalize_keys(season_avgs)
        context['last_5_averages'] = normalize_keys(l5_avgs)
        context['last_10_averages'] = normalize_keys(l10_avgs)
        context['home_averages'] = normalize_keys(home_avgs)
        context['away_averages'] = normalize_keys(away_avgs)

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
            
            # Inject Team Stats (Pace, Defense)
            if opponent_clean in self.team_stats:
                stats = self.team_stats[opponent_clean]
                context['opponent_pace'] = stats.get('pace')
                context['opponent_def_rating'] = stats.get('def_rating')
                context['opponent_stats'] = stats
                
                # Calculate universal defense factors
                # Factor > 1.0 means team allows MORE than average (Bad defense / Good Matchup)
                pts_factor = stats.get('opp_pts', 114.0) / self.league_averages.get('pts', 114.0)
                reb_factor = stats.get('opp_reb', 44.0) / self.league_averages.get('reb', 44.0)
                ast_factor = stats.get('opp_ast', 26.0) / self.league_averages.get('ast', 26.0)
                
                # Assign to all positions (general team defense)
                # Future: Scrape actual position splits
                def_profile = {
                   'pts': pts_factor,
                   'reb': reb_factor,
                   'ast': ast_factor
                }
                
                context['opponent_def_vs_position'] = {
                    'G': def_profile,
                    'F': def_profile,
                    'C': def_profile,
                }


        # B2B detection - check if team played on previous day
        # Use DB query first, fall back to recent_games
        context['is_b2b'] = self._detect_b2b(game)

        # --- Injury Alpha: find injured teammates ---
        if team and game_date:
            injured = self._find_injured_teammates(team, game_date)
            # Remove the player themselves from injured list
            injured = [p for p in injured if p.lower() != player_name.lower()]
            if injured:
                context['injured_teammates'] = injured

        # --- Matchup History: extract vs-team games from recent_games ---
        if opponent_clean:
            vs_history = self._extract_vs_team_history(game, opponent_clean)
            if vs_history:
                context['vs_team_history'] = vs_history

        # --- CLV Tracker: compute model_direction from baseline vs line ---
        line = context.get('opening_line') or context.get('current_line')
        try:
            from ..signals.stat_helpers import get_baseline
            season_avg_baseline = get_baseline(stat_type, context)
        except ImportError:
            season_avg_baseline = None
        if season_avg_baseline is not None and line is not None:
            if season_avg_baseline > line:
                context['model_direction'] = 'OVER'
            elif season_avg_baseline < line:
                context['model_direction'] = 'UNDER'

        # --- Blowout Risk: estimate spread from team ratings ---
        is_home = context.get('is_home', True)
        if team and opponent_clean:
            estimated_spread = self._estimate_spread(team, opponent_clean, is_home)
            if estimated_spread is not None:
                context['vegas_spread'] = estimated_spread
                # Also set avg_minutes from season averages if available
                sa = context.get('season_averages', {})
                if sa.get('min'):
                    context['avg_minutes'] = sa['min']

        # --- Defender Matchup: find known defender on opponent ---
        position = game.get('position', '')
        if opponent_clean and position:
            defender = self._find_primary_defender(opponent_clean, position)
            if defender:
                context['primary_defender'] = defender

        return context

    def _detect_b2b(self, game: Dict) -> bool:
        """
        Detect if this game is a back-to-back by checking if the team
        played on the previous day. Uses DB query first, then falls back
        to recent_games JSONB data.
        """
        team = game.get('team', '')
        game_date = game.get('game_date', '')

        if not team or not game_date:
            return False

        try:
            # Handle both string and date objects
            if isinstance(game_date, str):
                game_dt = datetime.strptime(game_date, '%Y-%m-%d')
            else:
                game_dt = game_date

            prev_date = (game_dt - timedelta(days=1)).strftime('%Y-%m-%d')

            # Method 1: DB query
            if self.db_connection is not None:
                try:
                    cursor = self.db_connection.cursor()
                    cursor.execute("""
                        SELECT COUNT(*) FROM prizepicks_daily_lines
                        WHERE team = %s AND game_date = %s
                        LIMIT 1
                    """, (team, prev_date))

                    result = cursor.fetchone()
                    cursor.close()

                    if result and result[0] > 0:
                        return True
                except Exception as e:
                    logger.debug(f"B2B DB detection failed: {e}")

            # Method 2: Check recent_games JSONB for game on previous day
            recent_games = game.get('recent_games') or []
            if isinstance(recent_games, str):
                try:
                    recent_games = json.loads(recent_games)
                except (json.JSONDecodeError, TypeError):
                    recent_games = []

            if isinstance(recent_games, list):
                for g in recent_games:
                    g_date = g.get('GAME_DATE') or g.get('game_date', '')
                    if isinstance(g_date, str) and prev_date in g_date:
                        return True

            return False
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
                    int(sa.total_predictions),
                    int(sa.correct_predictions),
                    float(sa.accuracy),
                    int(sa.over_predictions),
                    int(sa.over_correct),
                    int(sa.under_predictions),
                    int(sa.under_correct),
                    float(sa.avg_error),
                    bool(sa.total_predictions >= 10),
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
