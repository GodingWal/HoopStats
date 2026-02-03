"""
Referee Assignment Signal

Referee tendencies significantly affect game outcomes:
- Some refs call 10+ more fouls per game than others
- This impacts free throw volume, foul trouble, pace, and scoring
- Publicly available data from NBA.com / PBPStats

Context required:
    - referee_names: List[str] of assigned referees
    - OR referee_stats: Dict with pre-fetched ref tendencies
"""

from typing import Dict, Any, Optional, List
from .base import BaseSignal, SignalResult, registry


class RefereeSignal(BaseSignal):
    """
    Adjust projections based on referee assignment tendencies.

    Key referee impacts:
    - Foul rate → FT attempts → Points
    - Pace (loose whistle = more stoppages but also more FTs)
    - Foul trouble risk → Minutes reduction
    - Over/under tendencies (some refs consistently produce higher totals)
    """

    name = "referee"
    description = "Referee tendency adjustment"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.55

    # League average fouls per game (per crew)
    LEAGUE_AVG_FOULS = 42.0

    # League average FTA per game (both teams combined)
    LEAGUE_AVG_FTA = 44.0

    # Minimum deviation from league average to fire signal
    MIN_FOUL_DEVIATION = 0.05  # 5% above/below average

    # Known referee tendencies (fouls_per_game, fta_factor, pace_factor)
    # fta_factor: multiplier on expected FTA (>1 = more FTs)
    # pace_factor: multiplier on pace (>1 = faster)
    # These should be updated from real data periodically
    REFEREE_TENDENCIES = {
        # Tight whistles (fewer fouls)
        "Tony Brothers": {'fouls_per_game': 38.5, 'fta_factor': 0.92, 'pace_factor': 0.98, 'over_rate': 0.48},
        "Scott Foster": {'fouls_per_game': 39.0, 'fta_factor': 0.93, 'pace_factor': 0.97, 'over_rate': 0.47},
        "Ed Malloy": {'fouls_per_game': 39.5, 'fta_factor': 0.94, 'pace_factor': 0.99, 'over_rate': 0.49},

        # League average
        "Josh Tiven": {'fouls_per_game': 42.0, 'fta_factor': 1.00, 'pace_factor': 1.00, 'over_rate': 0.50},
        "Sean Wright": {'fouls_per_game': 42.5, 'fta_factor': 1.01, 'pace_factor': 1.00, 'over_rate': 0.51},
        "James Williams": {'fouls_per_game': 41.5, 'fta_factor': 0.99, 'pace_factor': 1.00, 'over_rate': 0.50},

        # Loose whistles (more fouls)
        "Kane Fitzgerald": {'fouls_per_game': 45.5, 'fta_factor': 1.08, 'pace_factor': 1.02, 'over_rate': 0.54},
        "Michael Smith": {'fouls_per_game': 46.0, 'fta_factor': 1.10, 'pace_factor': 1.01, 'over_rate': 0.55},
        "Rodney Mott": {'fouls_per_game': 44.5, 'fta_factor': 1.06, 'pace_factor': 1.01, 'over_rate': 0.53},
        "Curtis Blair": {'fouls_per_game': 45.0, 'fta_factor': 1.07, 'pace_factor': 1.02, 'over_rate': 0.54},
        "Ben Taylor": {'fouls_per_game': 44.0, 'fta_factor': 1.05, 'pace_factor': 1.00, 'over_rate': 0.52},

        # Very loose
        "Karl Lane": {'fouls_per_game': 47.0, 'fta_factor': 1.12, 'pace_factor': 1.03, 'over_rate': 0.56},
        "JB DeRosa": {'fouls_per_game': 46.5, 'fta_factor': 1.11, 'pace_factor': 1.02, 'over_rate': 0.55},
    }

    # Stat sensitivity to referee style
    STAT_FTA_SENSITIVITY = {
        'Points': 0.8,       # Points heavily affected by FT volume
        'Rebounds': 0.2,     # Slight effect (more FTs = more missed FT rebounds)
        'Assists': 0.3,      # Moderate (more stops = different flow)
        '3-Pointers Made': 0.1,  # Minimal direct effect
        'Pts+Rebs+Asts': 0.5,
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate referee-based adjustment."""

        # Get referee information
        ref_stats = self._get_referee_stats(context)
        if ref_stats is None:
            return self._create_neutral_result()

        # Calculate combined crew tendency
        fta_factor = ref_stats['fta_factor']
        pace_factor = ref_stats['pace_factor']

        # Check if deviation is significant
        fta_deviation = abs(fta_factor - 1.0)
        if fta_deviation < self.MIN_FOUL_DEVIATION:
            return self._create_neutral_result()

        # Get baseline
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        # Get player's FT rate to determine impact
        player_ftr = context.get('player_ftr', 0.25)  # Default FT rate
        avg_minutes = context.get('avg_minutes', 30.0)

        # Calculate FTA impact on points
        stat_sensitivity = self.STAT_FTA_SENSITIVITY.get(stat_type, 0.3)

        # Adjustment components:
        # 1. FTA impact: more fouls = more FTs for high-FTR players
        fta_adjustment = baseline * (fta_factor - 1.0) * stat_sensitivity * player_ftr / 0.25

        # 2. Pace impact: loose refs can slightly affect pace
        pace_adjustment = baseline * (pace_factor - 1.0) * 0.3

        # 3. Foul trouble risk: tight refs increase foul trouble probability
        foul_trouble_adjustment = 0.0
        is_starter = context.get('player_is_starter', avg_minutes >= 25)
        if is_starter and fta_factor < 0.95:
            # Tight refs → more foul trouble risk → potential minutes loss
            foul_trouble_adjustment = -baseline * 0.02
        elif is_starter and fta_factor > 1.08:
            # Loose refs → opponent in foul trouble → more FTs for our player
            foul_trouble_adjustment = baseline * 0.01

        total_adjustment = fta_adjustment + pace_adjustment + foul_trouble_adjustment

        # Determine direction
        if total_adjustment > 0:
            direction = 'OVER'
        elif total_adjustment < 0:
            direction = 'UNDER'
        else:
            return self._create_neutral_result()

        # Confidence scales with magnitude of deviation
        confidence = min(0.50 + fta_deviation * 1.5, 0.65)

        return self._create_result(
            adjustment=total_adjustment,
            direction=direction,
            confidence=confidence,
            metadata={
                'referee_names': ref_stats.get('names', []),
                'crew_fta_factor': fta_factor,
                'crew_pace_factor': pace_factor,
                'crew_fouls_per_game': ref_stats.get('fouls_per_game', self.LEAGUE_AVG_FOULS),
                'player_ftr': player_ftr,
                'fta_adjustment': fta_adjustment,
                'pace_adjustment': pace_adjustment,
                'foul_trouble_adjustment': foul_trouble_adjustment,
                'stat_sensitivity': stat_sensitivity,
            },
            sample_size=ref_stats.get('games_reffed', 30),
        )

    def _get_referee_stats(self, context: Dict[str, Any]) -> Optional[Dict]:
        """Get referee crew statistics from context."""

        # Pre-fetched stats take priority
        if 'referee_stats' in context:
            return context['referee_stats']

        # Look up from referee names
        referee_names = context.get('referee_names') or []
        if not referee_names:
            return None

        # Average the crew's tendencies
        matched_refs = []
        for ref_name in referee_names:
            if ref_name in self.REFEREE_TENDENCIES:
                matched_refs.append(self.REFEREE_TENDENCIES[ref_name])

        if not matched_refs:
            return None

        n = len(matched_refs)
        return {
            'names': referee_names,
            'fta_factor': sum(r['fta_factor'] for r in matched_refs) / n,
            'pace_factor': sum(r['pace_factor'] for r in matched_refs) / n,
            'fouls_per_game': sum(r['fouls_per_game'] for r in matched_refs) / n,
            'over_rate': sum(r['over_rate'] for r in matched_refs) / n,
            'games_reffed': 30 * n,  # Approximate
        }

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
registry.register(RefereeSignal())
