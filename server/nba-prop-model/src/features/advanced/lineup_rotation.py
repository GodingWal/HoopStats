"""
Lineup Rotation & Dynamics Features

Models how lineup context affects player performance:
- Expected minutes projection (the #1 predictor)
- Substitution pattern analysis
- Blowout risk impact on minutes
- With/without teammate performance splits
- Rotation stability metrics

Minutes explain 60-70% of stat variance - getting this right
is the highest-leverage feature engineering.
"""

from typing import Dict, Any, List, Optional
import numpy as np
import pandas as pd


class LineupRotationEngineer:
    """
    Engineer lineup and rotation features.

    Focuses on minutes projection (the #1 feature) and
    how lineup context affects per-minute production.
    """

    # Blowout thresholds
    BLOWOUT_SPREAD_THRESHOLD = 10.0  # |spread| > 10 = blowout risk
    GARBAGE_TIME_MARGIN = 20         # 20+ point margin in 4th = garbage time

    def __init__(self):
        pass

    def compute_lineup_features(
        self,
        game_log: pd.DataFrame,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute lineup and rotation features.

        Args:
            game_log: Player's game log (most recent first).
            context: Dict with team info, spread, injuries, etc.

        Returns:
            Dict of feature name -> value.
        """
        features = {}

        df = self._prepare_log(game_log)

        # Minutes projection and stability
        features.update(self._minutes_projection(df, context))

        # Blowout risk and minutes impact
        features.update(self._blowout_risk_features(context))

        # Rotation stability
        features.update(self._rotation_stability(df))

        # With/without teammate splits
        features.update(self._teammate_impact(context))

        # Starter/bench role features
        features.update(self._role_features(df, context))

        # Game flow expectations
        features.update(self._game_flow_features(context))

        return features

    # ------------------------------------------------------------------
    # Minutes projection
    # ------------------------------------------------------------------

    def _minutes_projection(
        self, df: pd.DataFrame, ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Project expected minutes with multi-factor model."""
        features = {}

        if len(df) < 3:
            base_min = ctx.get("projected_minutes", 25.0)
            features["projected_minutes"] = base_min
            features["minutes_confidence"] = 0.3
            features["minutes_floor"] = base_min * 0.6
            features["minutes_ceiling"] = min(base_min * 1.3, 42.0)
            return features

        # Weighted recent minutes (favor recent for rotation changes)
        min_values = df["MIN"].values.astype(float)

        if len(min_values) >= 10:
            # Weighted: 40% L3, 30% L5, 20% L10, 10% season
            l3 = np.mean(min_values[:3])
            l5 = np.mean(min_values[:5])
            l10 = np.mean(min_values[:10])
            season = np.mean(min_values)
            base_min = 0.40 * l3 + 0.30 * l5 + 0.20 * l10 + 0.10 * season
        elif len(min_values) >= 5:
            l3 = np.mean(min_values[:3])
            l5 = np.mean(min_values[:5])
            base_min = 0.50 * l3 + 0.50 * l5
        else:
            base_min = np.mean(min_values)

        # Adjustments
        adjustments = 0.0

        # B2B adjustment
        if ctx.get("is_b2b", False):
            adjustments -= 3.5

        # Injury-related minutes boost
        missing_minutes = ctx.get("total_missing_teammate_minutes", 0.0)
        if missing_minutes > 0:
            # Player absorbs portion of missing minutes
            usg_share = ctx.get("usage_rate_season", 20.0) / 100.0
            adjustments += min(missing_minutes * usg_share * 0.5, 6.0)

        # Blowout risk adjustment
        spread = abs(ctx.get("spread", 0.0))
        if spread >= 12:
            adjustments -= 4.0
        elif spread >= 8:
            adjustments -= 2.0

        # Rest bonus
        rest_days = ctx.get("rest_days", 1)
        if rest_days >= 3:
            adjustments += 1.5

        projected = base_min + adjustments
        projected = max(min(projected, 42.0), 5.0)

        features["projected_minutes"] = projected

        # Minutes confidence (based on stability)
        if len(min_values) >= 5:
            cv = np.std(min_values[:10]) / np.mean(min_values[:10]) if np.mean(min_values[:10]) > 0 else 1.0
            features["minutes_confidence"] = float(np.clip(1.0 - cv, 0.2, 0.95))
        else:
            features["minutes_confidence"] = 0.4

        # Floor/ceiling
        if len(min_values) >= 5:
            features["minutes_floor"] = float(np.percentile(min_values[:10], 10))
            features["minutes_ceiling"] = float(np.percentile(min_values[:10], 90))
        else:
            features["minutes_floor"] = projected * 0.65
            features["minutes_ceiling"] = min(projected * 1.25, 42.0)

        # Minutes trend
        if len(min_values) >= 5:
            recent_avg = np.mean(min_values[:3])
            older_avg = np.mean(min_values[3:8]) if len(min_values) >= 8 else np.mean(min_values[3:])
            features["minutes_trend"] = (recent_avg - older_avg) / older_avg if older_avg > 0 else 0.0
        else:
            features["minutes_trend"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Blowout risk
    # ------------------------------------------------------------------

    def _blowout_risk_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Blowout risk assessment and minutes impact."""
        features = {}

        spread = abs(ctx.get("spread", ctx.get("vegas_spread", 0.0)))
        total = ctx.get("vegas_total", ctx.get("game_total_ou", 225.0))

        # Blowout probability estimation
        if spread >= 14:
            blowout_prob = 0.40
        elif spread >= 10:
            blowout_prob = 0.25 + (spread - 10) / 4 * 0.15
        elif spread >= 6:
            blowout_prob = 0.10 + (spread - 6) / 4 * 0.15
        else:
            blowout_prob = spread / 6 * 0.10

        # High total + big spread = more blowout potential
        if total > 230:
            blowout_prob *= 1.1

        features["blowout_probability"] = float(np.clip(blowout_prob, 0, 0.55))

        # Expected minutes lost to blowout
        features["blowout_minutes_impact"] = -blowout_prob * 8.0

        # Is player on the favored team? (starters sit in blowout wins)
        is_favorite = ctx.get("is_favorite", spread < 0)
        features["is_favorite"] = 1.0 if is_favorite else 0.0

        # Favorites lose MORE minutes in blowouts (they sit starters)
        if is_favorite:
            features["blowout_minutes_at_risk"] = -blowout_prob * 10.0
        else:
            features["blowout_minutes_at_risk"] = -blowout_prob * 5.0  # Underdogs play starters longer

        # Competitive game likelihood (spread < 5)
        features["competitive_game_prob"] = float(np.clip(1.0 - spread / 10.0, 0.3, 1.0))

        return features

    # ------------------------------------------------------------------
    # Rotation stability
    # ------------------------------------------------------------------

    def _rotation_stability(self, df: pd.DataFrame) -> Dict[str, float]:
        """Measure how stable the player's rotation/minutes have been."""
        features = {}

        if len(df) < 5:
            features["rotation_stability"] = 0.5
            features["minutes_cv"] = 0.15
            features["dnp_risk"] = 0.0
            features["minutes_trend_consistency"] = 0.0
            return features

        min_values = df["MIN"].head(10).values.astype(float)
        mean_min = np.mean(min_values)
        std_min = np.std(min_values, ddof=1)

        # Coefficient of variation (lower = more stable)
        cv = std_min / mean_min if mean_min > 0 else 1.0
        features["minutes_cv"] = float(cv)

        # Stability score (inverse of CV, scaled 0-1)
        features["rotation_stability"] = float(np.clip(1.0 - cv / 0.3, 0, 1))

        # DNP risk (low minutes = might not play)
        if mean_min < 15:
            features["dnp_risk"] = 0.15
        elif mean_min < 20:
            features["dnp_risk"] = 0.05
        else:
            features["dnp_risk"] = 0.01

        # Minutes trend consistency (are changes gradual or volatile)
        if len(min_values) >= 4:
            diffs = np.diff(min_values[:5])
            features["minutes_trend_consistency"] = 1.0 - min(np.std(diffs) / 5.0, 1.0)
        else:
            features["minutes_trend_consistency"] = 0.5

        return features

    # ------------------------------------------------------------------
    # Teammate impact (with/without splits)
    # ------------------------------------------------------------------

    def _teammate_impact(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """With/without key teammate performance splits."""
        features = {}

        # On/off court impact from teammate absences
        on_off = ctx.get("on_off_splits", {})

        # Stat boost when specific teammates are out
        features["with_teammate_pts_diff"] = float(on_off.get("pts_diff", 0.0))
        features["with_teammate_usg_diff"] = float(on_off.get("usg_diff", 0.0))
        features["with_teammate_min_diff"] = float(on_off.get("min_diff", 0.0))

        # Number of key teammates out
        key_out = ctx.get("key_teammates_out", [])
        features["num_key_teammates_out"] = float(len(key_out))

        # Replacement quality (how good are the replacements for injured players)
        replacement_quality = ctx.get("replacement_quality", 0.5)
        features["replacement_quality"] = float(replacement_quality)

        # Expected team offensive rating change from injuries
        team_off_impact = ctx.get("team_off_rating_impact", 0.0)
        features["team_off_rating_delta"] = float(team_off_impact)

        return features

    # ------------------------------------------------------------------
    # Role features
    # ------------------------------------------------------------------

    def _role_features(
        self, df: pd.DataFrame, ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """Starter vs bench and role classification features."""
        features = {}

        avg_min = df["MIN"].mean() if len(df) > 0 else 25.0

        # Role classification
        if avg_min >= 32:
            role_score = 1.0   # Star / high-usage starter
        elif avg_min >= 26:
            role_score = 0.75  # Solid starter
        elif avg_min >= 20:
            role_score = 0.50  # Rotation player
        elif avg_min >= 14:
            role_score = 0.25  # Bench role
        else:
            role_score = 0.10  # Deep bench / DNP risk

        features["role_score"] = role_score
        features["is_starter"] = 1.0 if ctx.get("is_starter", avg_min >= 25) else 0.0

        # Minutes share of team total
        team_minutes = 240.0  # 5 players * 48 minutes
        features["minutes_share"] = avg_min / team_minutes

        return features

    # ------------------------------------------------------------------
    # Game flow features
    # ------------------------------------------------------------------

    def _game_flow_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Expected game flow features."""
        features = {}

        total = ctx.get("vegas_total", ctx.get("game_total_ou", 225.0))
        spread = ctx.get("spread", ctx.get("vegas_spread", 0.0))

        # Expected team total
        if spread != 0:
            team_total = (total - spread) / 2.0 if spread < 0 else (total + spread) / 2.0
        else:
            team_total = total / 2.0
        features["implied_team_total"] = team_total

        # Game pace expectation
        features["implied_game_pace"] = total / 2.25  # Rough pace estimate

        # Over/under indicator (high total = more stats for everyone)
        features["high_total_game"] = 1.0 if total > 230 else 0.0
        features["low_total_game"] = 1.0 if total < 215 else 0.0

        # Expected competitive minutes (non-garbage time)
        competitive_prob = features.get("competitive_game_prob",
                                        np.clip(1.0 - abs(spread) / 10.0, 0.3, 1.0))
        features["expected_competitive_minutes"] = 36.0 * competitive_prob + 24.0 * (1 - competitive_prob)

        return features

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _prepare_log(self, game_log: pd.DataFrame) -> pd.DataFrame:
        df = game_log.copy()
        if "MIN" in df.columns:
            if df["MIN"].dtype == "object":
                df["MIN"] = df["MIN"].apply(
                    lambda x: float(str(x).split(":")[0]) + float(str(x).split(":")[1]) / 60
                    if isinstance(x, str) and ":" in x else float(x) if not pd.isna(x) else 0
                )
            df["MIN"] = pd.to_numeric(df["MIN"], errors="coerce").fillna(0)
            df = df[df["MIN"] > 0]
        return df
