"""
Advanced Defensive Matchup & Opponent Context Features

The "holy grail" of player prop prediction - understanding WHO is
guarding the player and HOW the defense plays.

Key features:
- Opponent defensive rating by position/role (pace-adjusted)
- Matchup difficulty score (composite)
- Defensive scheme detection (blitz/drop/hedge/switch)
- Aggression+ and Variance+ metrics for defensive schemes
- Historical player vs. specific defensive archetypes
- Pace-adjusted opponent stats
"""

from typing import Dict, Any, List, Optional
import numpy as np


class DefensiveMatchupEngineer:
    """
    Engineer advanced defensive matchup features.

    Goes beyond simple "opponent defensive rating" to capture:
    1. Position-specific defensive impact (guards vs guards, etc.)
    2. Scheme-level adjustments (drop coverage = more midrange, etc.)
    3. Pace-adjusted opponent context
    4. Matchup difficulty composite score
    5. Defensive variance (some defenses are exploitable by certain archetypes)
    """

    # Defensive scheme archetypes and their stat impacts
    # Format: {scheme: {stat: multiplier vs league avg}}
    SCHEME_IMPACTS = {
        "blitz": {
            # Aggressive trapping on pick-and-roll
            "pts": 0.97,   # Fewer points for ball handler
            "ast": 1.08,   # More assists (4v3 after trap)
            "tov": 1.15,   # More turnovers from traps
            "fg3m": 1.05,  # Open 3s from scramble rotations
            "reb": 1.02,
        },
        "drop": {
            # Big drops back on PnR, protects rim
            "pts": 1.03,   # More midrange open for guards
            "ast": 0.96,   # Fewer assist opportunities
            "tov": 0.95,   # Less pressure on ball
            "fg3m": 0.92,  # Closer to 3pt line in rotation
            "reb": 0.98,
        },
        "switch": {
            # Switch everything - exploitable by mismatches
            "pts": 1.05,   # Guards can attack bigs
            "ast": 0.98,
            "tov": 0.97,
            "fg3m": 1.04,  # Shoot over slower defenders
            "reb": 1.03,   # Bigs slower to box out after switch
        },
        "hedge": {
            # Hard hedge on screens, recover
            "pts": 0.99,
            "ast": 1.02,
            "tov": 1.05,
            "fg3m": 0.98,
            "reb": 1.00,
        },
        "zone": {
            # Zone defense (rare but used situationally)
            "pts": 0.96,   # Fewer driving lanes
            "ast": 0.94,   # Harder to create for others
            "tov": 0.93,   # Less ball pressure
            "fg3m": 1.10,  # Open 3s from zone gaps
            "reb": 1.05,   # Harder to box out in zone
        },
    }

    # Position defensive archetype multipliers
    # How much each position's defense varies from team average
    POSITION_DEFENSE_VARIANCE = {
        "G": {"pts": 1.08, "ast": 0.95, "fg3m": 1.10, "stl": 1.15},
        "F": {"pts": 1.00, "reb": 1.05, "blk": 1.08, "fg3m": 1.02},
        "C": {"pts": 0.92, "reb": 0.90, "blk": 0.85, "fg3m": 0.95},
    }

    # NBA arena altitudes and timezone offsets (from EST)
    ARENA_INFO = {
        "DEN": {"altitude": 5280, "tz_offset": -2},
        "UTA": {"altitude": 4226, "tz_offset": -2},
        "PHX": {"altitude": 1086, "tz_offset": -2},
        "POR": {"altitude": 50, "tz_offset": -3},
        "SAC": {"altitude": 30, "tz_offset": -3},
        "LAL": {"altitude": 340, "tz_offset": -3},
        "LAC": {"altitude": 340, "tz_offset": -3},
        "GSW": {"altitude": 10, "tz_offset": -3},
        "SEA": {"altitude": 175, "tz_offset": -3},
        "BOS": {"altitude": 141, "tz_offset": 0},
        "NYK": {"altitude": 33, "tz_offset": 0},
        "BKN": {"altitude": 33, "tz_offset": 0},
        "PHI": {"altitude": 39, "tz_offset": 0},
        "MIA": {"altitude": 6, "tz_offset": 0},
        "ATL": {"altitude": 1050, "tz_offset": 0},
        "CHI": {"altitude": 597, "tz_offset": -1},
        "MIL": {"altitude": 617, "tz_offset": -1},
        "CLE": {"altitude": 653, "tz_offset": 0},
        "DET": {"altitude": 600, "tz_offset": 0},
        "IND": {"altitude": 715, "tz_offset": 0},
        "TOR": {"altitude": 249, "tz_offset": 0},
        "WAS": {"altitude": 0, "tz_offset": 0},
        "ORL": {"altitude": 82, "tz_offset": 0},
        "CHA": {"altitude": 751, "tz_offset": 0},
        "MEM": {"altitude": 337, "tz_offset": -1},
        "NOP": {"altitude": 3, "tz_offset": -1},
        "DAL": {"altitude": 430, "tz_offset": -1},
        "HOU": {"altitude": 43, "tz_offset": -1},
        "SAS": {"altitude": 650, "tz_offset": -1},
        "OKC": {"altitude": 1201, "tz_offset": -1},
        "MIN": {"altitude": 830, "tz_offset": -1},
    }

    def __init__(self):
        pass

    def compute_defensive_matchup_features(
        self,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute advanced defensive matchup features.

        Args:
            context: Dict containing opponent info, player position, etc.

        Returns:
            Dict of feature name -> value.
        """
        features = {}

        # Opponent defensive context (pace-adjusted)
        features.update(self._opponent_defense_context(context))

        # Position-specific defensive matchup
        features.update(self._positional_defense_features(context))

        # Defensive scheme impact
        features.update(self._scheme_features(context))

        # Matchup difficulty composite score
        features.update(self._matchup_difficulty_score(context, features))

        # Pace-adjusted opponent stats
        features.update(self._pace_adjusted_opponent(context))

        # Historical performance vs defensive archetypes
        features.update(self._vs_defense_archetype(context))

        return features

    # ------------------------------------------------------------------
    # Opponent defensive context
    # ------------------------------------------------------------------

    def _opponent_defense_context(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Opponent's defensive profile features."""
        features = {}

        # Defensive rating (points allowed per 100 possessions)
        opp_def_rating = ctx.get("opp_def_rating", 112.0)
        features["opp_def_rating_raw"] = opp_def_rating

        # Normalize to league average (112 = avg)
        features["opp_def_rating_vs_avg"] = opp_def_rating - 112.0

        # Defensive rating percentile (1=best, 0=worst)
        # Approximate using sigmoid centered at 112
        features["opp_def_percentile"] = 1.0 / (1.0 + np.exp(-(opp_def_rating - 112.0) / 3.0))

        # Opponent steals per game (ball pressure proxy)
        opp_stl = ctx.get("opp_steals_per_game", 7.5)
        features["opp_stl_rate"] = opp_stl / 7.5  # Normalized to league avg

        # Opponent blocks per game (rim protection proxy)
        opp_blk = ctx.get("opp_blocks_per_game", 5.0)
        features["opp_blk_rate"] = opp_blk / 5.0

        # Opponent forced turnovers
        opp_tov_forced = ctx.get("opp_turnovers_forced", 14.0)
        features["opp_tov_forced_rate"] = opp_tov_forced / 14.0

        # Opponent 3PT% allowed
        opp_3pt_allowed = ctx.get("opp_3pt_pct_allowed", 0.36)
        features["opp_3pt_pct_allowed"] = opp_3pt_allowed
        features["opp_3pt_defense_vs_avg"] = opp_3pt_allowed - 0.36

        # Opponent FTA allowed (fouling tendency)
        opp_fta_allowed = ctx.get("opp_fta_allowed_per_game", 22.0)
        features["opp_foul_rate"] = opp_fta_allowed / 22.0

        return features

    def _positional_defense_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Position-specific defensive matchup features."""
        features = {}

        player_pos = ctx.get("player_position", "G")
        opp_team = ctx.get("opponent_team", "")

        # Opponent stats allowed by position
        pos_stats = ctx.get("opp_pos_defense", {})
        if not pos_stats and player_pos:
            # Use position archetype defaults
            pos_stats = self.POSITION_DEFENSE_VARIANCE.get(player_pos[0], {})

        for stat in ["pts", "reb", "ast", "fg3m", "stl", "blk"]:
            multiplier = pos_stats.get(stat, 1.0)
            features[f"opp_pos_def_{stat}"] = multiplier

        # Opponent rank vs position (1-30)
        opp_pos_rank = ctx.get("opp_pos_def_rank", 15)
        features["opp_pos_def_rank_norm"] = opp_pos_rank / 30.0

        # Points allowed to position vs league avg
        opp_pts_to_pos = ctx.get("opp_pts_allowed_to_pos", 0.0)
        league_avg_pts_to_pos = ctx.get("league_avg_pts_to_pos", 20.0)
        if league_avg_pts_to_pos > 0:
            features["opp_pts_to_pos_vs_avg"] = (
                opp_pts_to_pos - league_avg_pts_to_pos
            ) / league_avg_pts_to_pos
        else:
            features["opp_pts_to_pos_vs_avg"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Defensive scheme features
    # ------------------------------------------------------------------

    def _scheme_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Features based on opponent defensive scheme."""
        features = {}

        scheme = ctx.get("opp_defensive_scheme", "unknown")
        scheme = scheme.lower() if isinstance(scheme, str) else "unknown"

        # One-hot encode scheme type
        for scheme_name in self.SCHEME_IMPACTS:
            features[f"opp_scheme_{scheme_name}"] = 1.0 if scheme == scheme_name else 0.0

        # Get scheme impact multipliers for current scheme
        impacts = self.SCHEME_IMPACTS.get(scheme, {})
        for stat in ["pts", "ast", "tov", "fg3m", "reb"]:
            features[f"scheme_impact_{stat}"] = impacts.get(stat, 1.0)

        # Scheme aggression score (how disruptive is the defense)
        aggression_map = {
            "blitz": 0.85, "hedge": 0.65, "switch": 0.50,
            "drop": 0.30, "zone": 0.40,
        }
        features["opp_scheme_aggression"] = aggression_map.get(scheme, 0.50)

        # Scheme variance score (how much outcome variance does scheme create)
        variance_map = {
            "blitz": 0.80, "zone": 0.70, "switch": 0.60,
            "hedge": 0.45, "drop": 0.35,
        }
        features["opp_scheme_variance"] = variance_map.get(scheme, 0.50)

        return features

    # ------------------------------------------------------------------
    # Matchup difficulty composite
    # ------------------------------------------------------------------

    def _matchup_difficulty_score(
        self, ctx: Dict[str, Any], existing_features: Dict[str, float]
    ) -> Dict[str, float]:
        """
        Composite matchup difficulty score (0 = easiest, 1 = hardest).

        Combines:
        - Opponent defensive rating
        - Position-specific defense
        - Scheme aggression
        - Rim protection / perimeter pressure
        """
        features = {}

        # Component scores (each 0-1, higher = harder matchup)
        def_rating = existing_features.get("opp_def_rating_raw", 112.0)
        # Inverse: lower rating = better defense = harder matchup
        def_score = max(0, min(1, (120.0 - def_rating) / 16.0))

        pos_rank = existing_features.get("opp_pos_def_rank_norm", 0.5)
        # Lower rank = better defense vs position = harder
        pos_score = 1.0 - pos_rank

        aggression = existing_features.get("opp_scheme_aggression", 0.5)

        stl_rate = existing_features.get("opp_stl_rate", 1.0)
        blk_rate = existing_features.get("opp_blk_rate", 1.0)
        pressure_score = min((stl_rate + blk_rate) / 2.0, 1.5) / 1.5

        # Weighted composite
        difficulty = (
            0.35 * def_score +
            0.25 * pos_score +
            0.20 * aggression +
            0.20 * pressure_score
        )

        features["matchup_difficulty"] = float(np.clip(difficulty, 0, 1))

        # Also compute stat-specific difficulty
        stat_type = ctx.get("stat_type", "Points")
        stat_key = stat_type.lower()[:3]
        pos_def_mult = existing_features.get(f"opp_pos_def_{stat_key}", 1.0)
        scheme_mult = existing_features.get(f"scheme_impact_{stat_key}", 1.0)

        # Combined matchup multiplier for the specific stat
        features["stat_matchup_multiplier"] = pos_def_mult * scheme_mult

        return features

    # ------------------------------------------------------------------
    # Pace-adjusted opponent stats
    # ------------------------------------------------------------------

    def _pace_adjusted_opponent(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Pace-adjusted opponent defensive stats."""
        features = {}

        opp_pace = ctx.get("opp_pace", 100.0)
        team_pace = ctx.get("team_pace", 100.0)
        expected_pace = (opp_pace + team_pace) / 2.0
        league_pace = 100.0

        pace_factor = expected_pace / league_pace
        features["expected_game_pace_factor"] = pace_factor

        # Pace-adjusted points allowed
        opp_pts_allowed = ctx.get("opp_pts_allowed", 112.0)
        features["opp_pace_adj_pts_allowed"] = opp_pts_allowed / pace_factor

        # Pace-adjusted opponent efficiency (per 100 possessions)
        features["opp_def_efficiency_pace_adj"] = ctx.get("opp_def_rating", 112.0)

        # Expected possessions in the game
        features["expected_possessions"] = expected_pace * 0.48  # ~48 min game

        # Opponent transition defense (fast pace teams often bad in transition)
        opp_fastbreak_allowed = ctx.get("opp_fastbreak_pts_allowed", 14.0)
        features["opp_transition_defense"] = opp_fastbreak_allowed / 14.0

        return features

    # ------------------------------------------------------------------
    # Historical vs defensive archetypes
    # ------------------------------------------------------------------

    def _vs_defense_archetype(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Player's historical performance vs different defensive profiles."""
        features = {}

        # Performance vs elite defense (def rating < 108)
        vs_elite = ctx.get("player_vs_elite_defense", {})
        features["vs_elite_def_avg"] = float(vs_elite.get("avg", 0.0))
        features["vs_elite_def_sample"] = float(vs_elite.get("games", 0))

        # Performance vs poor defense (def rating > 116)
        vs_poor = ctx.get("player_vs_poor_defense", {})
        features["vs_poor_def_avg"] = float(vs_poor.get("avg", 0.0))
        features["vs_poor_def_sample"] = float(vs_poor.get("games", 0))

        # Differential (how much better vs bad defense)
        elite_avg = features["vs_elite_def_avg"]
        poor_avg = features["vs_poor_def_avg"]
        if elite_avg > 0 and poor_avg > 0:
            features["defense_sensitivity"] = (poor_avg - elite_avg) / elite_avg
        else:
            features["defense_sensitivity"] = 0.0

        # Player vs specific opponent (head-to-head history)
        vs_opp = ctx.get("player_vs_opponent", {})
        features["vs_opp_avg"] = float(vs_opp.get("avg", 0.0))
        features["vs_opp_games"] = float(vs_opp.get("games", 0))
        features["vs_opp_hit_rate"] = float(vs_opp.get("hit_rate", 0.5))

        return features
