"""
Lineup-Aware Projections

Tracks which teammates a player shares the floor with and adjusts
projections based on lineup context.

A player's stats shift when they share the floor with different
teammates even when everyone is healthy.
"""

from typing import Dict, List, Optional, Tuple
import numpy as np
from dataclasses import dataclass, field


@dataclass
class LineupContext:
    """Context about a player's lineup situation."""
    teammates_in: List[str] = field(default_factory=list)
    teammates_out: List[str] = field(default_factory=list)
    projected_lineup: List[str] = field(default_factory=list)
    bench_unit_minutes: float = 0.0  # Expected minutes with bench unit


@dataclass
class LineupImpact:
    """Impact of a specific lineup configuration on a player's stats."""
    pts_impact: float = 0.0
    reb_impact: float = 0.0
    ast_impact: float = 0.0
    fg3m_impact: float = 0.0
    minutes_with_lineup: float = 0.0
    sample_games: int = 0


class LineupAwareProjector:
    """
    Adjusts projections based on which teammates are in the lineup.

    Key concepts:
    1. On/off splits: How a player performs with vs without key teammates
    2. Lineup minutes distribution: How many minutes with starters vs bench
    3. Pace/spacing effects: Different lineups have different spacing and pace

    Biggest impacts:
    - When a key ballhandler is in: assists and usage redistribution
    - When a stretch big is in: better spacing → more 3PA
    - When a rim protector is in: fewer paint points for opponents
    """

    # Minimum shared minutes to trust a lineup split
    MIN_SHARED_MINUTES = 100

    # Minimum games together for on/off calculation
    MIN_GAMES_TOGETHER = 10

    # Known high-impact lineup pairings (pre-calculated)
    # Format: (player, teammate) → stat_impacts
    HIGH_IMPACT_PAIRINGS = {
        # Playmaker effect: having an elite playmaker changes everyone's game
        ("Jaylen Brown", "Jayson Tatum"): {
            'pts': -2.5, 'ast': -0.8, 'fg3m': 0.3,  # Tatum takes shots
        },
        ("Jayson Tatum", "Jaylen Brown"): {
            'pts': -1.8, 'ast': 0.5, 'fg3m': 0.2,
        },

        # Spacing effect: stretch bigs open driving lanes
        ("LeBron James", "Anthony Davis"): {
            'pts': 1.5, 'ast': 0.8, 'reb': -1.2,
        },
        ("Anthony Davis", "LeBron James"): {
            'pts': 1.2, 'ast': -0.5, 'reb': 0.5,
        },

        # Ball-dominant effect: second star defers
        ("Kyrie Irving", "Luka Doncic"): {
            'pts': -3.0, 'ast': -1.5, 'fg3m': -0.2,
        },
        ("Luka Doncic", "Kyrie Irving"): {
            'pts': -1.0, 'ast': 1.0, 'fg3m': 0.0,
        },

        # Point guard effect on big man
        ("Nikola Jokic", "Jamal Murray"): {
            'pts': 1.5, 'ast': -1.0, 'reb': 0.0,
        },

        # Defensive anchor changes pace
        ("Bam Adebayo", "Jimmy Butler"): {
            'pts': -1.5, 'ast': 0.5, 'reb': 0.8,
        },
    }

    def calculate_lineup_adjustment(
        self,
        player_name: str,
        lineup_context: LineupContext,
        on_off_data: Optional[Dict[str, Dict]] = None,
    ) -> Dict[str, float]:
        """
        Calculate stat adjustments based on lineup context.

        Args:
            player_name: The player being projected
            lineup_context: Current lineup information
            on_off_data: Optional pre-calculated on/off splits
                         Format: {teammate_name: {'on': {stat: val}, 'off': {stat: val}, 'minutes': N}}

        Returns:
            Dict with stat adjustments: {'pts': X, 'reb': Y, 'ast': Z, 'fg3m': W}
        """
        adjustments = {'pts': 0.0, 'reb': 0.0, 'ast': 0.0, 'fg3m': 0.0}

        # 1. Check known high-impact pairings
        for teammate in lineup_context.teammates_in:
            key = (player_name, teammate)
            if key in self.HIGH_IMPACT_PAIRINGS:
                impacts = self.HIGH_IMPACT_PAIRINGS[key]
                for stat, impact in impacts.items():
                    if stat in adjustments:
                        adjustments[stat] += impact

        for teammate in lineup_context.teammates_out:
            key = (player_name, teammate)
            if key in self.HIGH_IMPACT_PAIRINGS:
                # Reverse the impact (teammate is OUT)
                impacts = self.HIGH_IMPACT_PAIRINGS[key]
                for stat, impact in impacts.items():
                    if stat in adjustments:
                        adjustments[stat] -= impact

        # 2. Use on/off splits data if available
        if on_off_data:
            on_off_adj = self._calculate_on_off_adjustment(
                player_name, lineup_context, on_off_data
            )
            # Blend with known pairings (on/off data gets 60% weight)
            for stat in adjustments:
                if stat in on_off_adj:
                    known_adj = adjustments[stat]
                    data_adj = on_off_adj[stat]
                    if known_adj != 0 and data_adj != 0:
                        adjustments[stat] = 0.4 * known_adj + 0.6 * data_adj
                    elif data_adj != 0:
                        adjustments[stat] = data_adj

        # 3. Apply Bayesian shrinkage to prevent overreaction
        for stat in adjustments:
            adjustments[stat] = self._apply_shrinkage(
                adjustments[stat],
                stat,
                lineup_context,
            )

        return adjustments

    def _calculate_on_off_adjustment(
        self,
        player_name: str,
        lineup_context: LineupContext,
        on_off_data: Dict[str, Dict],
    ) -> Dict[str, float]:
        """Calculate adjustments from on/off splits data."""

        adjustments = {'pts': 0.0, 'reb': 0.0, 'ast': 0.0, 'fg3m': 0.0}

        for teammate in lineup_context.teammates_out:
            if teammate in on_off_data:
                data = on_off_data[teammate]
                minutes = data.get('minutes', 0)

                if minutes < self.MIN_SHARED_MINUTES:
                    continue

                on_stats = data.get('on', {})
                off_stats = data.get('off', {})

                # The player performs differently with vs without this teammate
                # When teammate is OUT, we expect the "off" numbers
                for stat in adjustments:
                    on_val = on_stats.get(stat, 0)
                    off_val = off_stats.get(stat, 0)
                    if on_val > 0:
                        diff = off_val - on_val
                        # Apply shrinkage based on sample size
                        trust = min(minutes / 500, 1.0)
                        adjustments[stat] += diff * trust

        for teammate in lineup_context.teammates_in:
            if teammate in on_off_data:
                data = on_off_data[teammate]
                minutes = data.get('minutes', 0)

                if minutes < self.MIN_SHARED_MINUTES:
                    continue

                on_stats = data.get('on', {})
                off_stats = data.get('off', {})

                # When teammate is IN, we expect the "on" numbers
                # Only adjust if player's averages are based on mixed minutes
                for stat in adjustments:
                    on_val = on_stats.get(stat, 0)
                    off_val = off_stats.get(stat, 0)
                    if off_val > 0:
                        diff = on_val - off_val
                        trust = min(minutes / 500, 1.0)
                        adjustments[stat] += diff * trust * 0.5  # Lower weight for "in"

        return adjustments

    def _apply_shrinkage(
        self,
        adjustment: float,
        stat: str,
        lineup_context: LineupContext,
    ) -> float:
        """Apply Bayesian shrinkage to lineup adjustments."""
        # Cap adjustments at reasonable levels
        max_adjustments = {
            'pts': 5.0,
            'reb': 2.5,
            'ast': 2.0,
            'fg3m': 1.0,
        }

        max_adj = max_adjustments.get(stat, 3.0)
        return np.clip(adjustment, -max_adj, max_adj)

    def estimate_starters_bench_split(
        self,
        avg_minutes: float,
        is_starter: bool,
    ) -> Tuple[float, float]:
        """
        Estimate how many minutes a player spends with starters vs bench.

        Returns (starter_minutes, bench_minutes)
        """
        if is_starter:
            # Starters typically play 60-70% with other starters
            starter_pct = 0.65
        else:
            # Bench players typically play 30-40% with starters
            starter_pct = 0.35

        starter_min = avg_minutes * starter_pct
        bench_min = avg_minutes * (1 - starter_pct)

        return starter_min, bench_min
