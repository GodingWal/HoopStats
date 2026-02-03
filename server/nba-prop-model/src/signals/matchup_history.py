"""
Recency-Weighted Matchup History Signal

Head-to-head history: how does player X perform specifically against team Y?
Some players consistently over/underperform vs specific defenses.

Weight recent matchups (this season) heavier than older ones,
and apply Bayesian shrinkage for small samples.

Context required:
    - vs_team_history: List[Dict] with game logs against this opponent
    - season_averages: Dict[str, float] for baseline
"""

from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry


class MatchupHistorySignal(BaseSignal):
    """
    Adjust based on player's historical performance vs specific opponent.

    Uses recency-weighted averaging with Bayesian shrinkage:
    - This season games: weight 1.0
    - Last season games: weight 0.5
    - Older games: weight 0.25
    - Regress toward season average based on sample size
    """

    name = "matchup_history"
    description = "Recency-weighted head-to-head matchup history"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.55

    # Minimum games vs this opponent to fire
    MIN_GAMES_VS = 3

    # Minimum deviation from baseline to fire signal
    MIN_DEVIATION_PCT = 0.08  # 8% above/below season average

    # Recency weights
    THIS_SEASON_WEIGHT = 1.0
    LAST_SEASON_WEIGHT = 0.5
    OLDER_WEIGHT = 0.25

    # Bayesian shrinkage: games needed before fully trusting the sample
    FULL_TRUST_GAMES = 10

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate matchup history adjustment."""

        vs_team_history = context.get('vs_team_history') or []
        if len(vs_team_history) < self.MIN_GAMES_VS:
            return self._create_neutral_result()

        stat_key = self._stat_to_key(stat_type)
        if stat_key is None:
            return self._create_neutral_result()

        # Get baseline
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Calculate recency-weighted average vs this team
        weighted_sum = 0.0
        weight_total = 0.0

        for game in vs_team_history:
            stat_value = self._extract_stat(game, stat_key, stat_type)
            if stat_value is None:
                continue

            # Determine recency weight
            weight = self._get_recency_weight(game, game_date)
            weighted_sum += stat_value * weight
            weight_total += weight

        if weight_total == 0:
            return self._create_neutral_result()

        vs_team_avg = weighted_sum / weight_total
        n_games = len([g for g in vs_team_history
                       if self._extract_stat(g, stat_key, stat_type) is not None])

        # Apply Bayesian shrinkage toward season average
        shrinkage_factor = min(n_games / self.FULL_TRUST_GAMES, 1.0)
        regressed_avg = (
            shrinkage_factor * vs_team_avg +
            (1 - shrinkage_factor) * baseline
        )

        # Calculate deviation
        deviation = regressed_avg - baseline
        deviation_pct = abs(deviation) / baseline if baseline > 0 else 0

        if deviation_pct < self.MIN_DEVIATION_PCT:
            return self._create_neutral_result()

        # Determine direction
        if deviation > 0:
            direction = 'OVER'
            matchup_type = 'FAVORABLE'
        else:
            direction = 'UNDER'
            matchup_type = 'UNFAVORABLE'

        # Confidence increases with sample size and deviation magnitude
        base_confidence = 0.48 + shrinkage_factor * 0.12
        confidence = min(base_confidence + deviation_pct * 0.3, 0.68)

        opponent = context.get('opponent_team', context.get('opponent', ''))

        return self._create_result(
            adjustment=deviation,
            direction=direction,
            confidence=confidence,
            metadata={
                'opponent': opponent,
                'vs_team_avg': vs_team_avg,
                'regressed_avg': regressed_avg,
                'season_avg': baseline,
                'deviation': deviation,
                'deviation_pct': deviation_pct,
                'games_vs_team': n_games,
                'shrinkage_factor': shrinkage_factor,
                'matchup_type': matchup_type,
            },
            sample_size=n_games,
        )

    def _get_recency_weight(self, game: Dict, current_date: str) -> float:
        """Determine recency weight for a game."""
        game_date = game.get('GAME_DATE') or game.get('game_date', '')
        season = game.get('SEASON_ID') or game.get('season', '')

        # If we can determine the season
        if season:
            current_year = current_date[:4] if current_date else '2025'
            try:
                # Season IDs like "2024-25" or "22024"
                if '-' in str(season):
                    season_year = int(str(season).split('-')[0])
                else:
                    season_year = int(str(season)[-4:]) if len(str(season)) >= 4 else 2024
                current_year_int = int(current_year)

                if season_year >= current_year_int - 1:
                    return self.THIS_SEASON_WEIGHT
                elif season_year >= current_year_int - 2:
                    return self.LAST_SEASON_WEIGHT
                else:
                    return self.OLDER_WEIGHT
            except (ValueError, TypeError):
                pass

        # Fallback: use game date proximity
        if game_date and current_date:
            try:
                from datetime import datetime
                if len(game_date) == 10 and game_date[4] == '-':
                    gd = datetime.strptime(game_date, '%Y-%m-%d')
                else:
                    gd = datetime.strptime(game_date, '%b %d, %Y')
                cd = datetime.strptime(current_date, '%Y-%m-%d')
                days_ago = (cd - gd).days

                if days_ago <= 365:
                    return self.THIS_SEASON_WEIGHT
                elif days_ago <= 730:
                    return self.LAST_SEASON_WEIGHT
                else:
                    return self.OLDER_WEIGHT
            except (ValueError, TypeError):
                pass

        return self.LAST_SEASON_WEIGHT  # Default middle weight

    def _extract_stat(
        self,
        game: Dict,
        stat_key: str,
        stat_type: str
    ) -> Optional[float]:
        """Extract stat value from a game log entry."""
        # Try uppercase keys (NBA API format)
        key_map = {
            'pts': ['PTS', 'pts', 'points'],
            'reb': ['REB', 'reb', 'rebounds'],
            'ast': ['AST', 'ast', 'assists'],
            'fg3m': ['FG3M', 'fg3m', 'threes', '3pm'],
        }

        keys = key_map.get(stat_key, [stat_key])
        for k in keys:
            if k in game:
                try:
                    return float(game[k])
                except (ValueError, TypeError):
                    continue

        # Handle PRA
        if stat_type == 'Pts+Rebs+Asts':
            pts = self._extract_stat(game, 'pts', 'Points')
            reb = self._extract_stat(game, 'reb', 'Rebounds')
            ast = self._extract_stat(game, 'ast', 'Assists')
            if pts is not None and reb is not None and ast is not None:
                return pts + reb + ast

        return None

    def _stat_to_key(self, stat_type: str) -> Optional[str]:
        """Map stat type to key."""
        stat_key_map = {
            'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
            '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra',
        }
        return stat_key_map.get(stat_type)

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        season_avgs = context.get('season_averages') or {}
        stat_key_map = {
            'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
            '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra',
        }
        key = stat_key_map.get(stat_type)
        if key and key in season_avgs:
            return season_avgs[key]
        if stat_type == 'Pts+Rebs+Asts':
            pts = season_avgs.get('pts', 0)
            reb = season_avgs.get('reb', 0)
            ast = season_avgs.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast
        return None


# Register signal with global registry
registry.register(MatchupHistorySignal())
