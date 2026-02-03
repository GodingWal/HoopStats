"""
Pace-Adjusted Per-Minute Rates

Normalizes player production to per-100-possessions before projecting,
then scales back by the projected game pace.

This removes noise from raw per-minute rates that are affected by
team pace rather than player skill.
"""

from typing import Dict, Tuple, Optional
import numpy as np
from dataclasses import dataclass


@dataclass
class PaceAdjustedRates:
    """Container for pace-adjusted per-100-possession rates."""
    pts_per_100: float = 0.0
    reb_per_100: float = 0.0
    ast_per_100: float = 0.0
    fg3m_per_100: float = 0.0
    stl_per_100: float = 0.0
    blk_per_100: float = 0.0
    tov_per_100: float = 0.0
    team_pace: float = 100.0  # Pace the rates were calculated at


class PaceAdjuster:
    """
    Converts raw per-minute rates to pace-adjusted per-100-possession rates,
    and projects stats based on expected game pace.
    """

    # League average pace (possessions per 48 minutes)
    LEAGUE_AVG_PACE = 100.0

    # Minutes per game assumed for per-48 conversion
    MINUTES_PER_GAME = 48.0

    def calculate_pace_adjusted_rates(
        self,
        pts_per_min: float,
        reb_per_min: float,
        ast_per_min: float,
        fg3m_per_min: float,
        stl_per_min: float,
        blk_per_min: float,
        tov_per_min: float,
        team_pace: float,
    ) -> PaceAdjustedRates:
        """
        Convert per-minute rates to per-100-possession rates.

        Per-minute rates are influenced by team pace:
        - Fast team = more possessions per minute = more counting stats per minute
        - But per-100-possessions rates are pace-neutral

        Formula: per_100 = per_min * 48 * (100 / team_pace)
        Simplifies to: per_100 = per_min * 4800 / team_pace
        """
        if team_pace <= 0:
            team_pace = self.LEAGUE_AVG_PACE

        conversion_factor = self.MINUTES_PER_GAME * (self.LEAGUE_AVG_PACE / team_pace)

        return PaceAdjustedRates(
            pts_per_100=pts_per_min * conversion_factor,
            reb_per_100=reb_per_min * conversion_factor,
            ast_per_100=ast_per_min * conversion_factor,
            fg3m_per_100=fg3m_per_min * conversion_factor,
            stl_per_100=stl_per_min * conversion_factor,
            blk_per_100=blk_per_min * conversion_factor,
            tov_per_100=tov_per_min * conversion_factor,
            team_pace=team_pace,
        )

    def project_stat_with_pace(
        self,
        per_100_rate: float,
        projected_minutes: float,
        projected_game_pace: float,
    ) -> float:
        """
        Project a stat by scaling pace-adjusted rate back to raw stat.

        Formula: projected = per_100_rate * (projected_minutes / 48) * (projected_game_pace / 100)
        """
        if projected_game_pace <= 0:
            projected_game_pace = self.LEAGUE_AVG_PACE

        minutes_fraction = projected_minutes / self.MINUTES_PER_GAME
        pace_factor = projected_game_pace / self.LEAGUE_AVG_PACE

        return per_100_rate * minutes_fraction * pace_factor

    def calculate_game_pace(
        self,
        team_pace: float,
        opponent_pace: float,
    ) -> float:
        """
        Estimate the pace of a specific game.

        Game pace is a function of both teams' tendencies:
        - Average of both teams, regressed toward league mean
        - Slightly favor the faster team (fast teams force pace more)
        """
        if team_pace <= 0:
            team_pace = self.LEAGUE_AVG_PACE
        if opponent_pace <= 0:
            opponent_pace = self.LEAGUE_AVG_PACE

        # Simple average of both teams
        raw_avg = (team_pace + opponent_pace) / 2

        # Regress 15% toward league average (game pace is more stable than team pace)
        regression_factor = 0.85
        projected = regression_factor * raw_avg + (1 - regression_factor) * self.LEAGUE_AVG_PACE

        return projected

    def get_pace_adjustment_factor(
        self,
        team_pace: float,
        opponent_pace: float,
    ) -> float:
        """
        Get a simple multiplier for adjusting raw projections.

        Returns a factor > 1.0 for fast-paced games and < 1.0 for slow-paced games.
        Useful as a quick adjustment without full per-100 conversion.
        """
        game_pace = self.calculate_game_pace(team_pace, opponent_pace)
        return game_pace / self.LEAGUE_AVG_PACE
