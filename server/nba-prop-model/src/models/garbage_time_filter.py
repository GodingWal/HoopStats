"""
Garbage Time Filtering

Filters out garbage time possessions when computing baseline rates.
Garbage time inflates stats unpredictably and adds noise to projections.

Garbage time defined as: margin > 20 points in 4th quarter,
or margin > 25 at any point in 2nd half.
"""

from typing import Dict, List, Tuple, Optional
import numpy as np
import pandas as pd
from dataclasses import dataclass


@dataclass
class FilteredStats:
    """Stats with garbage time filtered out."""
    pts_competitive: float  # Points scored in competitive minutes
    reb_competitive: float
    ast_competitive: float
    fg3m_competitive: float
    stl_competitive: float
    blk_competitive: float
    tov_competitive: float
    competitive_minutes: float
    total_minutes: float
    garbage_minutes: float
    games_with_garbage: int
    total_games: int

    @property
    def garbage_pct(self) -> float:
        """Percentage of minutes in garbage time."""
        if self.total_minutes <= 0:
            return 0.0
        return self.garbage_minutes / self.total_minutes

    @property
    def pts_per_competitive_min(self) -> float:
        if self.competitive_minutes <= 0:
            return 0.0
        return self.pts_competitive / self.competitive_minutes

    @property
    def reb_per_competitive_min(self) -> float:
        if self.competitive_minutes <= 0:
            return 0.0
        return self.reb_competitive / self.competitive_minutes

    @property
    def ast_per_competitive_min(self) -> float:
        if self.competitive_minutes <= 0:
            return 0.0
        return self.ast_competitive / self.competitive_minutes


class GarbageTimeFilter:
    """
    Filters garbage time from player game logs to get cleaner baseline rates.

    Approach:
    1. If play-by-play data available: directly identify garbage time possessions
    2. If only box score: estimate garbage time from final margin and game flow

    When game-level play-by-play is unavailable, uses heuristics:
    - Games with final margin > 20: estimate 15-25% garbage time for starters
    - Games with final margin > 30: estimate 25-40% garbage time for starters
    - Bench players play MORE in garbage time (inverse adjustment)
    """

    # Thresholds for garbage time detection
    BLOWOUT_MARGIN_20 = 20    # Mild blowout
    BLOWOUT_MARGIN_30 = 30    # Heavy blowout

    # Estimated garbage time minutes for starters in blowouts
    STARTER_GARBAGE_MINUTES = {
        20: 6.0,   # 20-pt margin → ~6 min garbage time
        25: 9.0,   # 25-pt margin → ~9 min
        30: 12.0,  # 30-pt margin → ~12 min
        35: 15.0,  # 35+ margin → ~15 min
    }

    # Per-minute production multiplier in garbage time
    # Starters produce less (often not playing), bench produces more
    GARBAGE_TIME_MULTIPLIER_STARTER = 0.6   # Starters less effective in garbage time
    GARBAGE_TIME_MULTIPLIER_BENCH = 1.4     # Bench guys feast in garbage time

    def filter_game_log(
        self,
        game_log: pd.DataFrame,
        is_starter: bool = True,
        avg_minutes: float = 30.0,
    ) -> FilteredStats:
        """
        Filter garbage time from a player's game log.

        Args:
            game_log: Player game log DataFrame with columns including:
                      PTS, REB, AST, FG3M, STL, BLK, TOV, MIN,
                      and optionally PLUS_MINUS or final margin info
            is_starter: Whether player is a starter (starters sit in garbage time)
            avg_minutes: Player's average minutes for classification

        Returns:
            FilteredStats with competitive-minutes-only production rates
        """
        if game_log is None or len(game_log) == 0:
            return FilteredStats(
                pts_competitive=0, reb_competitive=0, ast_competitive=0,
                fg3m_competitive=0, stl_competitive=0, blk_competitive=0,
                tov_competitive=0, competitive_minutes=0, total_minutes=0,
                garbage_minutes=0, games_with_garbage=0, total_games=0
            )

        total_pts = 0.0
        total_reb = 0.0
        total_ast = 0.0
        total_fg3m = 0.0
        total_stl = 0.0
        total_blk = 0.0
        total_tov = 0.0
        total_comp_min = 0.0
        total_min = 0.0
        total_garbage_min = 0.0
        games_with_garbage = 0

        for _, game in game_log.iterrows():
            minutes = self._safe_float(game.get('MIN', 0))
            if minutes <= 0:
                continue

            # Estimate garbage time minutes in this game
            garbage_min = self._estimate_garbage_minutes(game, is_starter, minutes)
            competitive_min = max(minutes - garbage_min, 0)

            if garbage_min > 0:
                games_with_garbage += 1

            # Adjust stats to remove garbage time production
            pts = self._safe_float(game.get('PTS', 0))
            reb = self._safe_float(game.get('REB', 0))
            ast = self._safe_float(game.get('AST', 0))
            fg3m = self._safe_float(game.get('FG3M', 0))
            stl = self._safe_float(game.get('STL', 0))
            blk = self._safe_float(game.get('BLK', 0))
            tov = self._safe_float(game.get('TOV', 0))

            if garbage_min > 0 and minutes > 0:
                # Estimate what portion of stats came in competitive time
                comp_ratio = self._estimate_competitive_production_ratio(
                    minutes, competitive_min, garbage_min, is_starter
                )
                total_pts += pts * comp_ratio
                total_reb += reb * comp_ratio
                total_ast += ast * comp_ratio
                total_fg3m += fg3m * comp_ratio
                total_stl += stl * comp_ratio
                total_blk += blk * comp_ratio
                total_tov += tov * comp_ratio
            else:
                total_pts += pts
                total_reb += reb
                total_ast += ast
                total_fg3m += fg3m
                total_stl += stl
                total_blk += blk
                total_tov += tov

            total_comp_min += competitive_min
            total_min += minutes
            total_garbage_min += garbage_min

        return FilteredStats(
            pts_competitive=total_pts,
            reb_competitive=total_reb,
            ast_competitive=total_ast,
            fg3m_competitive=total_fg3m,
            stl_competitive=total_stl,
            blk_competitive=total_blk,
            tov_competitive=total_tov,
            competitive_minutes=total_comp_min,
            total_minutes=total_min,
            garbage_minutes=total_garbage_min,
            games_with_garbage=games_with_garbage,
            total_games=len(game_log),
        )

    def get_competitive_per_minute_rates(
        self,
        game_log: pd.DataFrame,
        is_starter: bool = True,
        avg_minutes: float = 30.0,
    ) -> Dict[str, float]:
        """
        Get per-minute rates using only competitive minutes.

        Returns dict with keys: pts, reb, ast, fg3m, stl, blk, tov
        """
        filtered = self.filter_game_log(game_log, is_starter, avg_minutes)

        if filtered.competitive_minutes <= 0:
            return {
                'pts': 0.0, 'reb': 0.0, 'ast': 0.0,
                'fg3m': 0.0, 'stl': 0.0, 'blk': 0.0, 'tov': 0.0,
            }

        cm = filtered.competitive_minutes
        return {
            'pts': filtered.pts_competitive / cm,
            'reb': filtered.reb_competitive / cm,
            'ast': filtered.ast_competitive / cm,
            'fg3m': filtered.fg3m_competitive / cm,
            'stl': filtered.stl_competitive / cm,
            'blk': filtered.blk_competitive / cm,
            'tov': filtered.tov_competitive / cm,
        }

    def _estimate_garbage_minutes(
        self,
        game: pd.Series,
        is_starter: bool,
        total_minutes: float,
    ) -> float:
        """Estimate garbage time minutes from game data."""

        # Try to get final margin
        margin = None

        # PLUS_MINUS at game level approximates team margin
        if 'PLUS_MINUS' in game.index:
            pm = self._safe_float(game['PLUS_MINUS'])
            margin = abs(pm)

        # Or use explicit margin field
        if margin is None and 'final_margin' in game.index:
            margin = abs(self._safe_float(game['final_margin']))

        if margin is None or margin < self.BLOWOUT_MARGIN_20:
            return 0.0

        # Estimate garbage minutes based on margin
        for threshold in sorted(self.STARTER_GARBAGE_MINUTES.keys(), reverse=True):
            if margin >= threshold:
                base_garbage = self.STARTER_GARBAGE_MINUTES[threshold]
                break
        else:
            return 0.0

        if is_starter:
            # Starters play LESS in garbage time
            # But they may have already been pulled
            # Cap at a reasonable fraction of their total minutes
            return min(base_garbage, total_minutes * 0.35)
        else:
            # Bench players play MORE in garbage time
            # Their garbage time contribution is actually their normal time
            return 0.0  # Don't filter garbage time for bench players

    def _estimate_competitive_production_ratio(
        self,
        total_min: float,
        comp_min: float,
        garbage_min: float,
        is_starter: bool,
    ) -> float:
        """
        Estimate what fraction of stats came during competitive time.

        Starters produce at a lower rate in garbage time (often not playing).
        """
        if total_min <= 0:
            return 1.0

        if is_starter:
            # Starter's garbage time minutes have reduced production
            garbage_multiplier = self.GARBAGE_TIME_MULTIPLIER_STARTER
        else:
            garbage_multiplier = self.GARBAGE_TIME_MULTIPLIER_BENCH

        # Total production = competitive_production + garbage_production
        # total_stats = comp_rate * comp_min + garbage_rate * garbage_min
        # We want comp_rate * comp_min / total_stats
        # Assume per-min rate is constant, so:
        # comp_production = (comp_min / total_min) * total_stats
        # But garbage time production differs, so:
        # effective_minutes = comp_min + garbage_min * garbage_multiplier
        effective_minutes = comp_min + garbage_min * garbage_multiplier
        if effective_minutes <= 0:
            return 1.0

        # Ratio of competitive production to total
        return comp_min / effective_minutes

    def _safe_float(self, val) -> float:
        """Safely convert to float."""
        try:
            return float(val) if val is not None and not pd.isna(val) else 0.0
        except (ValueError, TypeError):
            return 0.0
