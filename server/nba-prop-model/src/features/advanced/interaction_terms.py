"""
Domain-Specific Interaction Terms

Hand-crafted interaction features that capture non-linear relationships
XGBoost benefits from. These encode domain knowledge about basketball
that pure ML would need thousands of samples to learn.

Pro tip from task: "high-usage player vs. elite perimeter defender on
back-to-back" - this is EXACTLY the kind of interaction term we need.

Key interaction categories:
1. Player archetype x Defensive scheme
2. Fatigue x Usage (high usage + tired = efficiency collapse)
3. Matchup x Venue (home/away x defense quality)
4. Pace x Minutes (fast pace + high minutes = more stats)
5. Injury context x Role (star out + high-usage remaining = explosion)
"""

from typing import Dict, Any
import numpy as np


class InteractionTermEngineer:
    """
    Generate domain-specific interaction features.

    These manually constructed interactions encode basketball
    knowledge that helps tree models find splits faster.
    """

    def __init__(self):
        pass

    def compute_interaction_features(
        self,
        features: Dict[str, float],
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute interaction terms from existing features.

        Args:
            features: Already-computed features from other engineers.
            context: Raw context for additional data.

        Returns:
            Dict of interaction feature name -> value.
        """
        interactions = {}

        # 1. Usage x Defense interactions
        interactions.update(self._usage_defense_interactions(features, context))

        # 2. Fatigue x Performance interactions
        interactions.update(self._fatigue_performance_interactions(features, context))

        # 3. Matchup x Venue interactions
        interactions.update(self._matchup_venue_interactions(features, context))

        # 4. Pace x Minutes interactions
        interactions.update(self._pace_minutes_interactions(features, context))

        # 5. Injury cascade x Role interactions
        interactions.update(self._injury_role_interactions(features, context))

        # 6. Streak x Matchup interactions
        interactions.update(self._streak_matchup_interactions(features, context))

        # 7. Shot quality x Defense interactions
        interactions.update(self._shot_quality_defense_interactions(features, context))

        # 8. Vegas x Player profile interactions
        interactions.update(self._vegas_player_interactions(features, context))

        return interactions

    # ------------------------------------------------------------------
    # 1. Usage x Defense
    # ------------------------------------------------------------------

    def _usage_defense_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        High-usage players vs elite/poor defense.
        Key insight: high-usage players SUFFER more vs elite defense
        because they can't pass off usage to better matchups.
        """
        interactions = {}

        usg = f.get("projected_usg_rate", f.get("usg_rate_l5", f.get("usage_rate_season", 20.0)))
        matchup_diff = f.get("matchup_difficulty", 0.5)
        opp_def_vs_avg = f.get("opp_def_rating_vs_avg", 0.0)

        # High usage x elite defense = big negative
        is_high_usage = 1.0 if usg >= 25.0 else 0.0
        is_elite_defense = 1.0 if matchup_diff >= 0.7 else 0.0
        interactions["ix_high_usg_x_elite_def"] = is_high_usage * is_elite_defense

        # High usage x poor defense = big positive
        is_poor_defense = 1.0 if matchup_diff <= 0.3 else 0.0
        interactions["ix_high_usg_x_poor_def"] = is_high_usage * is_poor_defense

        # Continuous interaction: usage * defense quality
        interactions["ix_usg_x_def_rating"] = (usg / 30.0) * (opp_def_vs_avg / 10.0)

        # Usage x position defense
        stat_matchup_mult = f.get("stat_matchup_multiplier", 1.0)
        interactions["ix_usg_x_pos_def"] = (usg / 30.0) * (stat_matchup_mult - 1.0) * 10.0

        return interactions

    # ------------------------------------------------------------------
    # 2. Fatigue x Performance
    # ------------------------------------------------------------------

    def _fatigue_performance_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        THE KEY INTERACTION: high-usage player on B2B vs elite defense.
        This is where books leave money on the table.
        """
        interactions = {}

        fatigue = f.get("cumulative_fatigue_score", 0.0)
        usg = f.get("projected_usg_rate", f.get("usg_rate_l5", 20.0))
        is_b2b = f.get("is_b2b", 0.0)
        matchup_diff = f.get("matchup_difficulty", 0.5)

        # THE GOLDEN INTERACTION: high usage + B2B + tough matchup
        is_high_usage = 1.0 if usg >= 25.0 else 0.0
        interactions["ix_high_usg_b2b_tough_matchup"] = (
            is_high_usage * is_b2b * (1.0 if matchup_diff >= 0.6 else 0.0)
        )

        # Fatigue x usage (continuous)
        interactions["ix_fatigue_x_usg"] = fatigue * (usg / 30.0)

        # B2B x minutes played recently (compounding fatigue)
        minutes_7d = ctx.get("minutes_last_7_days", 0)
        high_minutes_load = 1.0 if minutes_7d > 130 else 0.0
        interactions["ix_b2b_x_high_minutes_load"] = is_b2b * high_minutes_load

        # Fatigue x efficiency (tired players' efficiency drops)
        ts_pct = f.get("ts_pct_l5", 0.55)
        interactions["ix_fatigue_x_efficiency"] = fatigue * ts_pct

        # Age x fatigue (older players affected more)
        age = ctx.get("player_age", 27)
        age_factor = max(0, (age - 27) / 10.0)  # 0 at 27, 0.3 at 30, 0.6 at 33
        interactions["ix_age_x_fatigue"] = age_factor * fatigue

        # 3-in-4 nights x high usage = efficiency cliff
        is_3_in_4 = f.get("is_3_in_4", 0.0)
        interactions["ix_3in4_x_high_usg"] = is_3_in_4 * is_high_usage

        return interactions

    # ------------------------------------------------------------------
    # 3. Matchup x Venue
    # ------------------------------------------------------------------

    def _matchup_venue_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Home/away splits amplified by matchup quality."""
        interactions = {}

        is_home = f.get("is_home", ctx.get("is_home", 0.0))
        if isinstance(is_home, bool):
            is_home = 1.0 if is_home else 0.0
        matchup_diff = f.get("matchup_difficulty", 0.5)

        # Home game vs bad defense = amplified boost
        is_easy_matchup = 1.0 if matchup_diff <= 0.35 else 0.0
        interactions["ix_home_x_easy_matchup"] = is_home * is_easy_matchup

        # Road game vs elite defense = amplified penalty
        is_away = 1.0 - is_home
        is_tough_matchup = 1.0 if matchup_diff >= 0.65 else 0.0
        interactions["ix_away_x_tough_matchup"] = is_away * is_tough_matchup

        # Home x altitude (no altitude penalty at home)
        is_high_alt = f.get("is_high_altitude", 0.0)
        interactions["ix_away_x_high_altitude"] = is_away * is_high_alt

        return interactions

    # ------------------------------------------------------------------
    # 4. Pace x Minutes
    # ------------------------------------------------------------------

    def _pace_minutes_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Fast pace + high minutes = stat explosion potential."""
        interactions = {}

        pace_factor = f.get("expected_game_pace_factor", 1.0)
        projected_min = f.get("projected_minutes", 30.0)

        # Pace x minutes (continuous)
        interactions["ix_pace_x_minutes"] = pace_factor * (projected_min / 36.0)

        # Fast pace + 30+ minutes = high stat potential
        is_fast_pace = 1.0 if pace_factor >= 1.03 else 0.0
        is_high_minutes = 1.0 if projected_min >= 32.0 else 0.0
        interactions["ix_fast_pace_x_high_min"] = is_fast_pace * is_high_minutes

        # Slow pace x low minutes = low stat floor
        is_slow_pace = 1.0 if pace_factor <= 0.97 else 0.0
        is_low_minutes = 1.0 if projected_min <= 25.0 else 0.0
        interactions["ix_slow_pace_x_low_min"] = is_slow_pace * is_low_minutes

        # Vegas total x minutes share (implied production)
        total = ctx.get("vegas_total", 225.0)
        min_share = f.get("minutes_share", projected_min / 240.0)
        interactions["ix_total_x_minutes_share"] = (total / 225.0) * min_share

        return interactions

    # ------------------------------------------------------------------
    # 5. Injury cascade x Role
    # ------------------------------------------------------------------

    def _injury_role_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """When stars sit, remaining high-usage players explode."""
        interactions = {}

        star_out = f.get("star_teammate_out", 0.0)
        num_injured = f.get("num_injured_teammates", 0.0)
        usg = f.get("projected_usg_rate", f.get("usg_rate_l5", 20.0))
        role_score = f.get("role_score", 0.5)

        # Star out x high usage player = stat explosion
        is_high_usage = 1.0 if usg >= 22.0 else 0.0
        interactions["ix_star_out_x_high_usg"] = star_out * is_high_usage

        # Star out x starter role = most benefit
        interactions["ix_star_out_x_starter"] = star_out * role_score

        # Multiple injuries x role = cascading usage boost
        interactions["ix_multi_injury_x_role"] = min(num_injured, 3.0) * role_score

        # Usage boost x easy matchup = max upside
        usg_boost = f.get("usg_boost_from_injuries", 0.0)
        matchup_diff = f.get("matchup_difficulty", 0.5)
        is_easy = 1.0 if matchup_diff <= 0.4 else 0.0
        interactions["ix_usg_boost_x_easy_matchup"] = (usg_boost / 5.0) * is_easy

        return interactions

    # ------------------------------------------------------------------
    # 6. Streak x Matchup
    # ------------------------------------------------------------------

    def _streak_matchup_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Hot streak + easy matchup = ride the wave."""
        interactions = {}

        # Get any streak feature available
        hot_cold = 0.0
        for key in f:
            if "hot_cold" in key:
                hot_cold = f[key]
                break

        matchup_diff = f.get("matchup_difficulty", 0.5)

        # Hot streak x easy matchup
        is_hot = 1.0 if hot_cold > 0.1 else 0.0
        is_easy = 1.0 if matchup_diff <= 0.4 else 0.0
        interactions["ix_hot_streak_x_easy_matchup"] = is_hot * is_easy

        # Cold streak x tough matchup (double fade)
        is_cold = 1.0 if hot_cold < -0.1 else 0.0
        is_tough = 1.0 if matchup_diff >= 0.6 else 0.0
        interactions["ix_cold_streak_x_tough_matchup"] = is_cold * is_tough

        # Regression signal x matchup (overperforming + tough matchup = regression)
        qsq_regression = f.get("qsq_regression_signal", 0.0)
        interactions["ix_regression_x_matchup"] = qsq_regression * matchup_diff

        return interactions

    # ------------------------------------------------------------------
    # 7. Shot quality x Defense
    # ------------------------------------------------------------------

    def _shot_quality_defense_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Shot quality patterns vs defensive scheme."""
        interactions = {}

        # Rim-heavy player vs rim-protecting team
        rim_rate = f.get("estimated_rim_rate", f.get("shot_archetype_rim_runner", 0.3))
        blk_rate = f.get("opp_blk_rate", 1.0)
        interactions["ix_rim_player_x_rim_protect"] = rim_rate * blk_rate

        # Perimeter player vs perimeter defense
        three_rate = f.get("three_point_rate", f.get("shot_archetype_perimeter", 0.35))
        opp_3pt_def = f.get("opp_3pt_defense_vs_avg", 0.0)
        interactions["ix_three_heavy_x_3pt_def"] = three_rate * (1.0 + opp_3pt_def)

        # Slasher vs aggressive defense (more FTs)
        slasher_score = f.get("shot_archetype_slasher", 0.0)
        scheme_aggression = f.get("opp_scheme_aggression", 0.5)
        interactions["ix_slasher_x_aggressive_def"] = slasher_score * scheme_aggression

        return interactions

    # ------------------------------------------------------------------
    # 8. Vegas x Player profile
    # ------------------------------------------------------------------

    def _vegas_player_interactions(
        self, f: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Vegas lines x player usage profile."""
        interactions = {}

        total = ctx.get("vegas_total", 225.0)
        spread = abs(ctx.get("spread", ctx.get("vegas_spread", 0.0)))
        usg = f.get("projected_usg_rate", f.get("usg_rate_l5", 20.0))
        projected_min = f.get("projected_minutes", 30.0)

        # High total x high usage = stat ceiling
        high_total = 1.0 if total > 230 else 0.0
        high_usg = 1.0 if usg >= 25.0 else 0.0
        interactions["ix_high_total_x_high_usg"] = high_total * high_usg

        # Low total x low usage = stat floor
        low_total = 1.0 if total < 215 else 0.0
        low_usg = 1.0 if usg <= 18.0 else 0.0
        interactions["ix_low_total_x_low_usg"] = low_total * low_usg

        # Close game x starter = full minutes
        close_game = 1.0 if spread <= 4.0 else 0.0
        is_starter = f.get("is_starter", 0.0)
        interactions["ix_close_game_x_starter"] = close_game * is_starter

        # Implied production: (team total share) x (player minutes share)
        team_total = f.get("implied_team_total", total / 2.0)
        min_share = projected_min / 240.0
        interactions["ix_implied_production"] = (team_total / 112.0) * min_share * (usg / 20.0)

        return interactions
