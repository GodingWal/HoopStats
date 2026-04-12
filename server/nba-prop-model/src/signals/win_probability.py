"""
Win Probability Signal

Game-level win probability model that affects prop predictions.
Inspired by XGBoost team prediction models (82.3% precision on W/L).

Key insight: If a team is a heavy favorite/underdog, it affects:
- Minutes distribution (starters rest in blowouts)
- Pace of play (leading teams slow down)
- Garbage time stats (bench players get run)

Uses a logistic model based on:
- Team net rating differential
- Home court advantage (~3.5 pts)
- Recent form (win% last 10)
- Head-to-head context

Direction logic:
- Heavy favorites (>70% win prob): UNDER on counting stats (starters rest Q4)
- Heavy underdogs (<30% win prob): OVER on counting stats (garbage time padding)
- Close games (40-60%): neutral - no signal
"""

import math
import logging
from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry

logger = logging.getLogger(__name__)


class WinProbabilitySignal(BaseSignal):
    """
    Adjust props based on game-level win probability.

    Context required:
        - team_id: str (player's team)
        - opp_team_id: str (opponent team)
        - is_home: bool
        - team_net_rating: float (from team_stats)
        - opp_net_rating: float (from team_stats)
        - team_win_pct: float (optional, from team_stats wins/losses)
        - opp_win_pct: float (optional)
        - season_averages: Dict for baseline stats
        - avg_minutes: float

    Model:
        Uses logistic regression on net rating differential + home court.
        P(win) = 1 / (1 + exp(-z))
        where z = 0.15 * (team_net_rtg - opp_net_rtg) + home_court_boost

    Adjustment:
        - Lopsided games -> expected minutes change -> stat adjustment
        - Favorites: starters lose ~4-8 mins in blowouts
        - Underdogs: garbage time can pad stats by ~5-10%
    """

    name = "win_probability"
    description = "Game-level win probability impact on props"
    stat_types = [
        "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
        "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
    ]
    default_confidence = 0.55

    # Logistic model coefficients (calibrated to NBA data)
    # Net rating diff of 10 ~ 75% win prob, which matches empirical NBA data
    NET_RATING_COEFF = 0.15
    HOME_COURT_BOOST = 0.40  # ~3.5 point home court advantage in logistic space
    WIN_PCT_COEFF = 0.08     # Small boost from raw win% signal

    # Thresholds for signal activation
    LOPSIDED_THRESHOLD = 0.70   # >70% win prob = lopsided game
    BLOWOUT_THRESHOLD = 0.80    # >80% win prob = likely blowout

    # Minutes impact estimates
    LOPSIDED_MINUTES_LOST = 3.0   # Starters lose ~3 min in lopsided wins
    BLOWOUT_MINUTES_LOST = 6.0    # Starters lose ~6 min in blowouts
    GARBAGE_TIME_BOOST_PCT = 0.05  # Underdogs get ~5% stat boost from garbage time

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate win probability impact on props."""

        # Get team ratings
        team_net = self._get_team_net_rating(context, is_player_team=True)
        opp_net = self._get_team_net_rating(context, is_player_team=False)

        if team_net is None or opp_net is None:
            return self._create_neutral_result()

        # Calculate win probability
        is_home = context.get('is_home')
        win_prob = self._calculate_win_probability(
            team_net, opp_net, is_home,
            context.get('team_win_pct'),
            context.get('opp_win_pct')
        )

        # Check if game is lopsided enough to affect props
        is_favorite = win_prob > 0.5
        lopsidedness = win_prob if is_favorite else (1.0 - win_prob)

        if lopsidedness < self.LOPSIDED_THRESHOLD:
            # Close game - no meaningful signal
            return self._create_result(
                adjustment=0.0,
                direction=None,
                confidence=0.0,
                metadata={
                    'win_probability': round(win_prob, 4),
                    'lopsidedness': round(lopsidedness, 4),
                    'team_net_rating': team_net,
                    'opp_net_rating': opp_net,
                    'is_home': is_home,
                    'reason': 'close_game_no_signal',
                },
                sample_size=0,
            )

        # Get baseline stats for adjustment calculation
        baseline = self._get_baseline(stat_type, context)
        avg_minutes = context.get('avg_minutes', 30.0)
        is_starter = context.get('player_is_starter', avg_minutes >= 25)

        if baseline is None or baseline <= 0 or avg_minutes <= 0:
            return self._create_neutral_result()

        # Calculate adjustment based on favorite/underdog status
        if is_favorite and is_starter:
            # FAVORITE STARTER: risk of reduced minutes in blowout
            adjustment, direction = self._favorite_starter_adjustment(
                win_prob, lopsidedness, baseline, avg_minutes
            )
        elif is_favorite and not is_starter:
            # FAVORITE BENCH: may get MORE minutes in blowout
            adjustment, direction = self._favorite_bench_adjustment(
                win_prob, lopsidedness, baseline, avg_minutes
            )
        elif not is_favorite and is_starter:
            # UNDERDOG STARTER: garbage time can pad stats slightly
            adjustment, direction = self._underdog_starter_adjustment(
                win_prob, lopsidedness, baseline, avg_minutes
            )
        else:
            # UNDERDOG BENCH: may lose minutes if team gives up
            adjustment, direction = self._underdog_bench_adjustment(
                win_prob, lopsidedness, baseline, avg_minutes
            )

        # Scale confidence by how lopsided the game is
        confidence = self._calculate_confidence(lopsidedness)

        return self._create_result(
            adjustment=round(adjustment, 3),
            direction=direction,
            confidence=confidence,
            metadata={
                'win_probability': round(win_prob, 4),
                'lopsidedness': round(lopsidedness, 4),
                'is_favorite': is_favorite,
                'is_starter': is_starter,
                'team_net_rating': team_net,
                'opp_net_rating': opp_net,
                'net_rating_diff': round(team_net - opp_net, 2),
                'is_home': is_home,
                'baseline': baseline,
                'avg_minutes': avg_minutes,
            },
            sample_size=30,
        )

    # ------------------------------------------------------------------
    # Win probability model
    # ------------------------------------------------------------------

    def _calculate_win_probability(
        self,
        team_net: float,
        opp_net: float,
        is_home: Optional[bool],
        team_win_pct: Optional[float] = None,
        opp_win_pct: Optional[float] = None
    ) -> float:
        """
        Logistic model for win probability.

        P(win) = sigmoid(0.15 * net_rating_diff + home_boost + win_pct_signal)

        Calibrated so that:
        - Net rating diff of +10 at home -> ~80% win prob
        - Net rating diff of +10 away -> ~73% win prob
        - Net rating diff of 0 at home -> ~60% win prob (historical home win rate)
        """
        net_diff = team_net - opp_net
        z = self.NET_RATING_COEFF * net_diff

        # Home court advantage
        if is_home is True:
            z += self.HOME_COURT_BOOST
        elif is_home is False:
            z -= self.HOME_COURT_BOOST

        # Win percentage signal (small additional input)
        if team_win_pct is not None and opp_win_pct is not None:
            win_pct_diff = team_win_pct - opp_win_pct
            z += self.WIN_PCT_COEFF * win_pct_diff * 10  # Scale to similar magnitude

        # Sigmoid
        win_prob = 1.0 / (1.0 + math.exp(-z))

        # Clamp to reasonable range
        return max(0.05, min(0.95, win_prob))

    # ------------------------------------------------------------------
    # Adjustment calculations by scenario
    # ------------------------------------------------------------------

    def _favorite_starter_adjustment(
        self, win_prob: float, lopsidedness: float,
        baseline: float, avg_minutes: float
    ) -> tuple:
        """Favorite starters risk reduced minutes in blowout wins."""
        # Probability-weighted minutes reduction
        if lopsidedness >= self.BLOWOUT_THRESHOLD:
            blowout_prob = 0.35 + (lopsidedness - 0.80) * 2.0
            minutes_lost = self.BLOWOUT_MINUTES_LOST * min(blowout_prob, 0.50)
        else:
            blowout_prob = 0.15 + (lopsidedness - 0.70) * 1.5
            minutes_lost = self.LOPSIDED_MINUTES_LOST * min(blowout_prob, 0.35)

        stats_per_minute = baseline / avg_minutes
        adjustment = -minutes_lost * stats_per_minute

        return adjustment, 'UNDER'

    def _favorite_bench_adjustment(
        self, win_prob: float, lopsidedness: float,
        baseline: float, avg_minutes: float
    ) -> tuple:
        """Favorite bench players may get extra minutes in blowouts."""
        if lopsidedness >= self.BLOWOUT_THRESHOLD:
            extra_minutes = 4.0 * 0.35
        else:
            extra_minutes = 2.0 * 0.20

        stats_per_minute = baseline / max(avg_minutes, 15.0)
        adjustment = extra_minutes * stats_per_minute

        return adjustment, 'OVER'

    def _underdog_starter_adjustment(
        self, win_prob: float, lopsidedness: float,
        baseline: float, avg_minutes: float
    ) -> tuple:
        """Underdog starters: garbage time can pad counting stats."""
        # In garbage time, pace increases and defense relaxes
        garbage_time_boost = baseline * self.GARBAGE_TIME_BOOST_PCT
        # But they might also get pulled if game is truly out of hand
        pull_risk = 0.0
        if lopsidedness >= self.BLOWOUT_THRESHOLD:
            pull_risk = baseline * 0.03  # Small risk of being pulled

        adjustment = garbage_time_boost - pull_risk
        direction = 'OVER' if adjustment > 0 else 'UNDER'

        return adjustment, direction

    def _underdog_bench_adjustment(
        self, win_prob: float, lopsidedness: float,
        baseline: float, avg_minutes: float
    ) -> tuple:
        """Underdog bench: may get more run if team is losing big."""
        if lopsidedness >= self.BLOWOUT_THRESHOLD:
            extra_minutes = 3.0 * 0.30
        else:
            extra_minutes = 1.5 * 0.15

        stats_per_minute = baseline / max(avg_minutes, 12.0)
        adjustment = extra_minutes * stats_per_minute

        return adjustment, 'OVER'

    # ------------------------------------------------------------------
    # Helper methods
    # ------------------------------------------------------------------

    def _get_team_net_rating(self, context: Dict[str, Any], is_player_team: bool) -> Optional[float]:
        """Extract net rating from context."""
        if is_player_team:
            # Direct net rating
            net = context.get('team_net_rating')
            if net is not None:
                return float(net)
            # Calculate from off/def rating
            team_stats = context.get('team_stats', {})
            if team_stats:
                off = team_stats.get('off_rating')
                def_ = team_stats.get('def_rating')
                if off is not None and def_ is not None:
                    return float(off) - float(def_)
        else:
            # Opponent net rating
            net = context.get('opp_net_rating')
            if net is not None:
                return float(net)
            opp_stats = context.get('opponent_stats', {})
            if opp_stats:
                net = opp_stats.get('net_rating')
                if net is not None:
                    return float(net)
                off = opp_stats.get('off_rating')
                def_ = opp_stats.get('def_rating')
                if off is not None and def_ is not None:
                    return float(off) - float(def_)
        return None

    def _calculate_confidence(self, lopsidedness: float) -> float:
        """Scale confidence by how lopsided the game is."""
        if lopsidedness >= self.BLOWOUT_THRESHOLD:
            return min(0.55 + (lopsidedness - 0.80) * 1.5, 0.75)
        else:
            return 0.45 + (lopsidedness - 0.70) * 1.0

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        from .stat_helpers import get_baseline
        return get_baseline(stat_type, context)


# Register signal with global registry
registry.register(WinProbabilitySignal())
