"""
Usage & Efficiency Derivatives with Injury-Cascade Adjustments

Captures the "Wally Pipp Effect" - when a star sits, usage/minutes
redistribute across teammates in predictable patterns.

Key features:
- Projected USG% with injury-cascade adjustments
- True Shooting % and efficiency deltas (vs career, vs season)
- Points per minute with context adjustments
- Usage rate redistribution when teammates are out
- Efficiency stability metrics
"""

from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd


class UsageEfficiencyEngineer:
    """
    Engineer usage and efficiency derivative features.

    Goes beyond raw USG% and TS% to capture:
    1. How usage changes with teammate absences (injury cascade)
    2. Efficiency trends relative to career/season baselines
    3. Context-adjusted per-minute production rates
    """

    # League average baselines (2024-25 season approximations)
    LEAGUE_AVG_TS_PCT = 0.575
    LEAGUE_AVG_USG_RATE = 20.0
    LEAGUE_AVG_PTS_PER_MIN = 0.47
    LEAGUE_AVG_PACE = 100.0

    # Injury cascade: estimated USG% redistribution per missing USG point
    # When a player with X USG% sits, remaining players absorb proportionally
    REDISTRIBUTION_DECAY = 0.65  # Top option gets 65% of available usage

    def __init__(self):
        pass

    def compute_usage_efficiency_features(
        self,
        game_log: pd.DataFrame,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute full usage and efficiency feature set.

        Args:
            game_log: Player's game log (most recent first).
            context: Dict with injury info, career stats, team data.

        Returns:
            Dict of feature name -> value.
        """
        features = {}

        df = self._prepare_log(game_log)
        if len(df) < 3:
            return self._default_features()

        # Core efficiency metrics
        features.update(self._efficiency_metrics(df))

        # Efficiency deltas (vs baselines)
        features.update(self._efficiency_deltas(df, context))

        # Projected usage with injury cascade
        features.update(self._injury_cascade_usage(df, context))

        # Per-minute production rates with context
        features.update(self._per_minute_rates(df, context))

        # Efficiency stability / variance
        features.update(self._efficiency_stability(df))

        return features

    # ------------------------------------------------------------------
    # Efficiency metrics
    # ------------------------------------------------------------------

    def _efficiency_metrics(self, df: pd.DataFrame) -> Dict[str, float]:
        """Core efficiency calculations across windows."""
        features = {}

        for window, label in [(5, "l5"), (10, "l10"), (len(df), "season")]:
            subset = df.head(window)
            if len(subset) == 0:
                continue

            pts = subset["PTS"].sum()
            fga = subset["FGA"].sum()
            fta = subset["FTA"].sum()
            fgm = subset["FGM"].sum()
            fg3m = subset.get("FG3M", pd.Series([0])).sum()
            fg3a = subset.get("FG3A", pd.Series([0])).sum()
            tov = subset.get("TOV", pd.Series([0])).sum()
            minutes = subset["MIN"].sum()

            # True Shooting %
            tsa = fga + 0.44 * fta
            ts_pct = pts / (2 * tsa) if tsa > 0 else 0.0
            features[f"ts_pct_{label}"] = ts_pct

            # Effective FG%
            efg_pct = (fgm + 0.5 * fg3m) / fga if fga > 0 else 0.0
            features[f"efg_pct_{label}"] = efg_pct

            # Free throw rate (FTA/FGA) - measures aggressiveness
            ftr = fta / fga if fga > 0 else 0.0
            features[f"ftr_{label}"] = ftr

            # Usage rate estimate
            possessions_used = fga + 0.44 * fta + tov
            if minutes > 0:
                usg = (possessions_used / minutes) * 48 / 5
            else:
                usg = 0.0
            features[f"usg_rate_{label}"] = usg

            # Points per minute
            ppm = pts / minutes if minutes > 0 else 0.0
            features[f"pts_per_min_{label}"] = ppm

            # Three-point attempt rate (3PAr)
            three_par = fg3a / fga if fga > 0 else 0.0
            features[f"three_par_{label}"] = three_par

            # Assist-to-turnover ratio
            ast = subset["AST"].sum()
            ast_tov = ast / tov if tov > 0 else ast
            features[f"ast_tov_ratio_{label}"] = min(ast_tov, 10.0)

        return features

    def _efficiency_deltas(
        self, df: pd.DataFrame, context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Efficiency changes relative to baselines."""
        features = {}

        # Current TS% (L5)
        subset = df.head(5)
        pts = subset["PTS"].sum()
        fga = subset["FGA"].sum()
        fta = subset["FTA"].sum()
        tsa = fga + 0.44 * fta
        current_ts = pts / (2 * tsa) if tsa > 0 else self.LEAGUE_AVG_TS_PCT

        # Career TS% baseline
        career_ts = context.get("career_ts_pct", self.LEAGUE_AVG_TS_PCT)
        features["ts_delta_vs_career"] = current_ts - career_ts

        # Season TS% baseline
        season_ts = context.get("season_ts_pct", current_ts)
        features["ts_delta_vs_season"] = current_ts - season_ts

        # TS% vs league average (measures overall shooting talent + shot quality)
        features["ts_delta_vs_league"] = current_ts - self.LEAGUE_AVG_TS_PCT

        # Usage delta (L5 vs season) - indicates role change
        season_usg = context.get("usage_rate_season", self.LEAGUE_AVG_USG_RATE)
        l5_usg = context.get("usage_rate_l5", season_usg)
        features["usg_delta_l5_vs_season"] = l5_usg - season_usg

        # Efficiency-volume tradeoff: TS% change per unit USG% change
        if abs(l5_usg - season_usg) > 1.0:
            features["efficiency_volume_tradeoff"] = (
                (current_ts - season_ts) / (l5_usg - season_usg)
            )
        else:
            features["efficiency_volume_tradeoff"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Injury cascade / Wally Pipp effect
    # ------------------------------------------------------------------

    def _injury_cascade_usage(
        self, df: pd.DataFrame, context: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Project usage rate adjustments from teammate injuries.

        The "Wally Pipp Effect": when a high-usage teammate sits,
        remaining players absorb that usage proportionally to their
        existing usage share.
        """
        features = {}

        # Current player's baseline usage
        base_usg = context.get("usage_rate_season", self.LEAGUE_AVG_USG_RATE)

        # Get injured teammates and their usage rates
        injured_teammates = context.get("injured_teammates", {})
        # Format: {"Player Name": {"usg_rate": 28.5, "minutes": 34.2}, ...}

        total_missing_usg = 0.0
        total_missing_minutes = 0.0
        star_missing = False

        for player_name, info in injured_teammates.items():
            if isinstance(info, dict):
                missing_usg = info.get("usg_rate", 0.0)
                missing_min = info.get("minutes", 0.0)
            else:
                missing_usg = float(info) if info else 0.0
                missing_min = 0.0

            total_missing_usg += missing_usg
            total_missing_minutes += missing_min

            if missing_usg >= 25.0:
                star_missing = True

        # Calculate redistributed usage
        # Player absorbs usage proportional to their share of remaining usage
        team_remaining_usg = max(100.0 - total_missing_usg, 50.0)
        player_usg_share = base_usg / team_remaining_usg

        # Higher-usage players absorb disproportionately more
        # Apply power law: share^0.7 gives more to top options
        adjusted_share = player_usg_share ** 0.7
        usage_boost = total_missing_usg * adjusted_share * self.REDISTRIBUTION_DECAY

        projected_usg = base_usg + usage_boost

        features["projected_usg_rate"] = min(projected_usg, 45.0)
        features["usg_boost_from_injuries"] = usage_boost
        features["total_missing_teammate_usg"] = total_missing_usg
        features["total_missing_teammate_minutes"] = total_missing_minutes
        features["star_teammate_out"] = 1.0 if star_missing else 0.0
        features["num_injured_teammates"] = float(len(injured_teammates))

        # Minutes boost estimate
        if total_missing_minutes > 0:
            base_minutes = context.get("avg_minutes", 30.0)
            # Minutes redistribution is more constrained (48 min cap)
            minutes_pool = min(total_missing_minutes, 20.0)
            minutes_boost = minutes_pool * player_usg_share * 0.5
            features["projected_minutes_boost"] = min(minutes_boost, 8.0)
        else:
            features["projected_minutes_boost"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Per-minute rates with context
    # ------------------------------------------------------------------

    def _per_minute_rates(
        self, df: pd.DataFrame, context: Dict[str, Any]
    ) -> Dict[str, float]:
        """Per-minute production rates adjusted for context."""
        features = {}

        # Pace-adjusted per-minute rates
        game_pace = context.get("expected_pace", self.LEAGUE_AVG_PACE)
        pace_factor = game_pace / self.LEAGUE_AVG_PACE

        for stat, col in [("pts", "PTS"), ("reb", "REB"), ("ast", "AST"),
                          ("fg3m", "FG3M"), ("stl", "STL"), ("blk", "BLK")]:
            if col not in df.columns:
                continue
            # Raw per-minute (L10)
            subset = df.head(10)
            total_stat = subset[col].sum()
            total_min = subset["MIN"].sum()
            raw_per_min = total_stat / total_min if total_min > 0 else 0.0

            # Pace-adjusted per-minute
            features[f"pace_adj_{stat}_per_min"] = raw_per_min * pace_factor

        # Points per possession estimate
        subset = df.head(10)
        pts = subset["PTS"].sum()
        fga = subset["FGA"].sum()
        fta = subset["FTA"].sum()
        tov = subset.get("TOV", pd.Series([0])).sum()
        possessions = fga + 0.44 * fta + tov
        features["pts_per_poss"] = pts / possessions if possessions > 0 else 0.0

        return features

    # ------------------------------------------------------------------
    # Efficiency stability
    # ------------------------------------------------------------------

    def _efficiency_stability(self, df: pd.DataFrame) -> Dict[str, float]:
        """Measure efficiency stability across recent games."""
        features = {}

        if len(df) < 5:
            features["ts_stability"] = 0.0
            features["usg_stability"] = 0.0
            features["scoring_floor_pct"] = 0.0
            features["scoring_ceiling_pct"] = 0.0
            return features

        # Per-game TS% variance
        game_ts = []
        for _, row in df.head(10).iterrows():
            pts = row.get("PTS", 0)
            fga = row.get("FGA", 0)
            fta = row.get("FTA", 0)
            tsa = fga + 0.44 * fta
            if tsa > 0:
                game_ts.append(pts / (2 * tsa))

        if game_ts:
            features["ts_stability"] = 1.0 - min(np.std(game_ts), 0.15) / 0.15
        else:
            features["ts_stability"] = 0.0

        # Per-game usage variance
        game_usg = []
        for _, row in df.head(10).iterrows():
            fga = row.get("FGA", 0)
            fta = row.get("FTA", 0)
            tov = row.get("TOV", 0)
            minutes = row.get("MIN", 0)
            if minutes > 0:
                poss = fga + 0.44 * fta + tov
                game_usg.append((poss / minutes) * 48 / 5)

        if game_usg:
            features["usg_stability"] = 1.0 - min(np.std(game_usg), 5.0) / 5.0
        else:
            features["usg_stability"] = 0.0

        # Scoring floor/ceiling as percentage of mean
        pts_values = df["PTS"].head(10).values.astype(float)
        mean_pts = np.mean(pts_values)
        if mean_pts > 0:
            features["scoring_floor_pct"] = np.percentile(pts_values, 10) / mean_pts
            features["scoring_ceiling_pct"] = np.percentile(pts_values, 90) / mean_pts
        else:
            features["scoring_floor_pct"] = 0.0
            features["scoring_ceiling_pct"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _prepare_log(self, game_log: pd.DataFrame) -> pd.DataFrame:
        df = game_log.copy()
        if "MIN" in df.columns and df["MIN"].dtype == "object":
            df["MIN"] = pd.to_numeric(
                df["MIN"].apply(lambda x: float(str(x).split(":")[0]) + float(str(x).split(":")[1]) / 60 if ":" in str(x) else x),
                errors="coerce"
            ).fillna(0)
        numeric = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "MIN",
                    "FGM", "FGA", "FG3M", "FG3A", "FTM", "FTA", "OREB", "DREB"]
        for col in numeric:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        return df[df["MIN"] > 0] if "MIN" in df.columns else df

    def _default_features(self) -> Dict[str, float]:
        defaults = {}
        for label in ["l5", "l10", "season"]:
            defaults[f"ts_pct_{label}"] = self.LEAGUE_AVG_TS_PCT
            defaults[f"efg_pct_{label}"] = 0.50
            defaults[f"ftr_{label}"] = 0.30
            defaults[f"usg_rate_{label}"] = self.LEAGUE_AVG_USG_RATE
            defaults[f"pts_per_min_{label}"] = self.LEAGUE_AVG_PTS_PER_MIN
            defaults[f"three_par_{label}"] = 0.35
            defaults[f"ast_tov_ratio_{label}"] = 2.0
        defaults["ts_delta_vs_career"] = 0.0
        defaults["ts_delta_vs_season"] = 0.0
        defaults["ts_delta_vs_league"] = 0.0
        defaults["usg_delta_l5_vs_season"] = 0.0
        defaults["efficiency_volume_tradeoff"] = 0.0
        defaults["projected_usg_rate"] = self.LEAGUE_AVG_USG_RATE
        defaults["usg_boost_from_injuries"] = 0.0
        defaults["total_missing_teammate_usg"] = 0.0
        defaults["total_missing_teammate_minutes"] = 0.0
        defaults["star_teammate_out"] = 0.0
        defaults["num_injured_teammates"] = 0.0
        defaults["projected_minutes_boost"] = 0.0
        for stat in ["pts", "reb", "ast", "fg3m", "stl", "blk"]:
            defaults[f"pace_adj_{stat}_per_min"] = 0.0
        defaults["pts_per_poss"] = 0.0
        defaults["ts_stability"] = 0.0
        defaults["usg_stability"] = 0.0
        defaults["scoring_floor_pct"] = 0.0
        defaults["scoring_ceiling_pct"] = 0.0
        return defaults
