"""
Granular Defender Matchup Signal

Goes beyond positional defense buckets to specific defender tracking.
Who is the likely primary defender, and what's their on-court defensive rating?

This is especially impactful for star players where the matchup is predictable.

Context required:
    - primary_defender: str (name of likely primary defender)
    - defender_stats: Dict with defensive metrics for the defender
    - OR opponent_team + player_position for lookup
"""

from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry


class DefenderMatchupSignal(BaseSignal):
    """
    Adjust based on specific primary defender assignment.

    Goes beyond team-level defense to individual defender quality.
    Some matchups are highly predictable (e.g., star vs star).

    Key metrics:
    - Defender's on-court DRTG vs off-court
    - Points allowed per possession when defending
    - Contest rate and effectiveness
    - Historical head-to-head performance
    """

    name = "defender_matchup"
    description = "Specific primary defender matchup"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.58

    # Minimum deviation from average to fire signal
    MIN_DEFENDER_DEVIATION = 0.04  # 4%

    # Known elite defenders and their impact (defensive_factor < 1.0 = better defender)
    # These reduce opponent's expected stats by this factor
    ELITE_DEFENDERS = {
        # Perimeter defenders
        "Jrue Holiday": {'pts': 0.88, 'ast': 0.90, 'fg3m': 0.85, 'position': 'G'},
        "Alex Caruso": {'pts': 0.90, 'ast': 0.92, 'fg3m': 0.88, 'position': 'G'},
        "Derrick White": {'pts': 0.91, 'ast': 0.91, 'fg3m': 0.87, 'position': 'G'},
        "Herb Jones": {'pts': 0.89, 'ast': 0.93, 'fg3m': 0.86, 'position': 'F'},
        "OG Anunoby": {'pts': 0.90, 'ast': 0.94, 'fg3m': 0.88, 'position': 'F'},
        "Mikal Bridges": {'pts': 0.91, 'ast': 0.93, 'fg3m': 0.89, 'position': 'F'},
        "Matisse Thybulle": {'pts': 0.88, 'ast': 0.95, 'fg3m': 0.82, 'position': 'G'},
        "Luguentz Dort": {'pts': 0.90, 'ast': 0.92, 'fg3m': 0.87, 'position': 'G'},
        "Dyson Daniels": {'pts': 0.89, 'ast': 0.91, 'fg3m': 0.86, 'position': 'G'},

        # Rim protectors (mainly affect points/rebounds)
        "Rudy Gobert": {'pts': 0.86, 'reb': 0.90, 'ast': 1.00, 'position': 'C'},
        "Anthony Davis": {'pts': 0.88, 'reb': 0.92, 'ast': 0.98, 'position': 'C'},
        "Bam Adebayo": {'pts': 0.89, 'reb': 0.93, 'ast': 0.96, 'position': 'C'},
        "Jaren Jackson Jr": {'pts': 0.87, 'reb': 0.91, 'ast': 1.00, 'position': 'C'},
        "Evan Mobley": {'pts': 0.89, 'reb': 0.92, 'ast': 0.97, 'position': 'C'},
        "Victor Wembanyama": {'pts': 0.85, 'reb': 0.90, 'ast': 0.97, 'position': 'C'},
        "Chet Holmgren": {'pts': 0.88, 'reb': 0.91, 'ast': 0.99, 'position': 'C'},
    }

    # Known weak defenders (defensive_factor > 1.0 = worse defender)
    WEAK_DEFENDERS = {
        "Trae Young": {'pts': 1.12, 'ast': 1.05, 'fg3m': 1.10, 'position': 'G'},
        "Luka Doncic": {'pts': 1.08, 'ast': 1.04, 'fg3m': 1.06, 'position': 'G'},
        "James Harden": {'pts': 1.10, 'ast': 1.06, 'fg3m': 1.08, 'position': 'G'},
        "Kyrie Irving": {'pts': 1.06, 'ast': 1.03, 'fg3m': 1.05, 'position': 'G'},
        "Bradley Beal": {'pts': 1.08, 'ast': 1.04, 'fg3m': 1.06, 'position': 'G'},
        "Jordan Poole": {'pts': 1.14, 'ast': 1.06, 'fg3m': 1.12, 'position': 'G'},
        "Collin Sexton": {'pts': 1.10, 'ast': 1.05, 'fg3m': 1.08, 'position': 'G'},
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate defender-specific adjustment."""

        # Get defender information
        defender_factor = self._get_defender_factor(stat_type, context)
        if defender_factor is None:
            return self._create_neutral_result()

        # Check if deviation is significant
        deviation = defender_factor - 1.0
        if abs(deviation) < self.MIN_DEFENDER_DEVIATION:
            return self._create_neutral_result()

        # Get baseline
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Calculate adjustment
        adjustment = baseline * deviation

        # Incorporate head-to-head history if available
        h2h_adjustment = self._get_h2h_adjustment(stat_type, context)
        if h2h_adjustment is not None:
            # Blend: 60% defender rating, 40% head-to-head
            adjustment = adjustment * 0.6 + h2h_adjustment * 0.4

        # Determine direction
        if adjustment > 0:
            direction = 'OVER'
            matchup_type = 'WEAK_DEFENDER'
        else:
            direction = 'UNDER'
            matchup_type = 'ELITE_DEFENDER'

        # Higher confidence with known defenders
        primary_defender = context.get('primary_defender', '')
        is_known = (primary_defender in self.ELITE_DEFENDERS or
                    primary_defender in self.WEAK_DEFENDERS)
        confidence = 0.62 if is_known else 0.55

        # Scale confidence by deviation magnitude
        confidence = min(confidence + abs(deviation) * 0.5, 0.72)

        return self._create_result(
            adjustment=adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'primary_defender': primary_defender,
                'defender_factor': defender_factor,
                'deviation': deviation,
                'matchup_type': matchup_type,
                'is_known_defender': is_known,
                'h2h_adjustment': h2h_adjustment,
                'baseline': baseline,
            },
            sample_size=20 if is_known else 10,
        )

    def _get_defender_factor(
        self,
        stat_type: str,
        context: Dict[str, Any]
    ) -> Optional[float]:
        """Get defensive factor for the matchup."""

        stat_key = self._stat_to_key(stat_type)

        # Pre-provided defender stats
        defender_stats = context.get('defender_stats') or {}
        if defender_stats and stat_key in defender_stats:
            return defender_stats[stat_key]

        # Look up primary defender
        primary_defender = context.get('primary_defender', '')
        if not primary_defender:
            return None

        # Check elite defenders
        if primary_defender in self.ELITE_DEFENDERS:
            defender_data = self.ELITE_DEFENDERS[primary_defender]
            return defender_data.get(stat_key, defender_data.get('pts', 1.0))

        # Check weak defenders
        if primary_defender in self.WEAK_DEFENDERS:
            defender_data = self.WEAK_DEFENDERS[primary_defender]
            return defender_data.get(stat_key, defender_data.get('pts', 1.0))

        return None

    def _get_h2h_adjustment(
        self,
        stat_type: str,
        context: Dict[str, Any]
    ) -> Optional[float]:
        """Get head-to-head historical adjustment."""

        h2h_history = context.get('h2h_vs_defender') or []
        if len(h2h_history) < 3:
            return None

        stat_key = self._stat_to_key(stat_type)
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return None

        # Calculate average performance vs this defender
        h2h_values = [g.get(stat_key, 0) for g in h2h_history if stat_key in g]
        if not h2h_values:
            return None

        h2h_avg = sum(h2h_values) / len(h2h_values)
        return h2h_avg - baseline

    def _stat_to_key(self, stat_type: str) -> str:
        """Map stat type to key."""
        stat_key_map = {
            'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
            '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra',
        }
        return stat_key_map.get(stat_type, 'pts')

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
registry.register(DefenderMatchupSignal())
