"""
XGBoost Feature Engineering

Builds the full feature vector for XGBoost training and inference.
Combines existing edge scores with raw continuous numeric inputs,
volatility metrics, line movement data, and CLV tracking.

The key insight: existing edge scores (0-10 binned) lose information.
XGBoost needs the raw continuous values to learn optimal thresholds
and interaction effects that additive scoring can't capture.

Feature groups:
1. Existing edge scores (keep as inputs — let XGBoost see what your rules think)
2. Raw numeric inputs behind those edges (actual pace, defensive stats, etc.)
3. Volatility features (stdev, CoV, IQR — biggest current blind spot)
4. Line movement as numeric features
5. CLV tracking as numeric features
6. Meta features (total edges fired, signal score, etc.)
"""

from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
import numpy as np
from numpy.polynomial import polynomial as P


@dataclass
class XGBoostFeatureVector:
    """Complete feature vector for XGBoost model."""
    features: Dict[str, float]
    feature_names: List[str]
    target: Optional[int] = None  # 1 = hit (over line), 0 = miss

    def to_array(self) -> np.ndarray:
        """Convert to numpy array in consistent feature order."""
        return np.array([self.features.get(name, 0.0) for name in self.feature_names])

    def to_dict(self) -> Dict[str, Any]:
        """Serialize for database storage."""
        return {
            "features": self.features,
            "feature_names": self.feature_names,
            "target": self.target,
        }


# Canonical feature ordering — all models must use this exact order
XGBOOST_FEATURE_NAMES = [
    # --- Group 1: Existing edge scores (0-10 scale) ---
    "edge_star_out",
    "edge_b2b",
    "edge_blowout",
    "edge_pace",
    "edge_bad_defense",
    "edge_minutes_stability",
    "edge_recent_form",
    "edge_home_road",
    "edge_line_movement",
    "total_edges_fired",

    # --- Group 2: Raw numeric inputs (continuous) ---
    # Line vs. averages
    "line_vs_avg_l10",
    "line_vs_avg_l5",
    "line_vs_season_avg",

    # Pace (actual values, not binned)
    "team_pace_actual",
    "opp_pace_actual",
    "pace_differential",

    # Defense (actual values)
    "opp_def_rating",
    "opp_pts_allowed_to_pos",
    "player_vs_opp_hist_avg",

    # Minutes (actual values)
    "minutes_avg_l10",
    "minutes_avg_l5",
    "minutes_floor_l10",
    "minutes_stdev_l10",

    # Home/away split magnitude
    "home_away_diff",
    "home_away_diff_pct",
    "is_home",

    # Situational
    "days_rest",
    "is_b2b",
    "game_total_ou",
    "abs_spread",

    # Usage
    "usage_rate_season",
    "usage_rate_l5",
    "usage_delta",

    # Historical hit rate
    "hist_hit_rate",

    # --- Group 3: Volatility features ---
    "stdev_last_10",
    "coeff_of_variation",
    "pct_games_over_line",
    "iqr_last_10",

    # --- Group 4: Line movement (numeric) ---
    "line_move_direction",
    "line_move_magnitude",

    # --- Group 5: CLV tracking ---
    "closing_line_value",
    "clv_l10",

    # --- Group 6: Meta features ---
    "signal_score",
    "signal_count",
    "projected_value",
    "projected_minutes",

    # --- Group 7: Matchup-specific features ---
    "opp_pos_def_rank",
    "player_matchup_edge",
    "opp_pace_rank",
    "expected_game_pace",

    # --- Group 8: Trend/momentum features ---
    "trend_slope_l10",
    "trend_slope_l5",
    "games_above_line_streak",
    "last_game_delta",

    # --- Group 9: Market/odds features ---
    "implied_prob_over",
    "line_vs_consensus",
    "num_books_offering",
    "vig_magnitude",
]


class XGBoostFeatureBuilder:
    """
    Builds feature vectors for XGBoost from game context.

    Usage:
        builder = XGBoostFeatureBuilder()
        fv = builder.build(context)
        X = fv.to_array().reshape(1, -1)
    """

    def __init__(self):
        self.feature_names = XGBOOST_FEATURE_NAMES

    def build(self, context: Dict[str, Any]) -> XGBoostFeatureVector:
        """
        Build complete feature vector from game context.

        Args:
            context: Dict containing all available data about the player/game/prop.
                     Keys are flexible — missing keys default to 0.0.

        Returns:
            XGBoostFeatureVector with all features populated.
        """
        features: Dict[str, float] = {}

        # Group 1: Edge scores
        self._extract_edge_scores(context, features)

        # Group 2: Raw numeric inputs
        self._extract_raw_numerics(context, features)

        # Group 3: Volatility
        self._extract_volatility(context, features)

        # Group 4: Line movement
        self._extract_line_movement(context, features)

        # Group 5: CLV
        self._extract_clv(context, features)

        # Group 6: Meta
        self._extract_meta(context, features)

        # Group 7: Matchup-specific
        self._extract_matchup_features(context, features)

        # Group 8: Trend/momentum
        self._extract_trend_features(context, features)

        # Group 9: Market/odds
        self._extract_market_features(context, features)

        # Build target if actual result available
        target = self._compute_target(context)

        return XGBoostFeatureVector(
            features=features,
            feature_names=self.feature_names,
            target=target,
        )

    def build_training_row(
        self,
        context: Dict[str, Any],
        actual_value: float,
        line_value: float,
    ) -> XGBoostFeatureVector:
        """
        Build a labeled training row for XGBoost.

        Args:
            context: Game context at prediction time.
            actual_value: Post-game actual stat value.
            line_value: The betting line.

        Returns:
            XGBoostFeatureVector with target set.
        """
        fv = self.build(context)
        fv.target = int(actual_value > line_value)
        return fv

    # ------------------------------------------------------------------
    # Feature extraction helpers
    # ------------------------------------------------------------------

    def _extract_edge_scores(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract existing edge scores (0-10 binned)."""
        edges = ctx.get("edge_scores", {})

        f["edge_star_out"] = float(edges.get("star_out", 0))
        f["edge_b2b"] = float(edges.get("back_to_back", edges.get("b2b", 0)))
        f["edge_blowout"] = float(edges.get("blowout_risk", edges.get("blowout", 0)))
        f["edge_pace"] = float(edges.get("pace_matchup", edges.get("pace", 0)))
        f["edge_bad_defense"] = float(edges.get("bad_defense", edges.get("defense", 0)))
        f["edge_minutes_stability"] = float(edges.get("minutes_stability", edges.get("minutes", 0)))
        f["edge_recent_form"] = float(edges.get("recent_form", 0))
        f["edge_home_road"] = float(edges.get("home_road_split", edges.get("home_road", 0)))
        f["edge_line_movement"] = float(edges.get("line_movement", 0))

        # Count how many edges fired (score > 0)
        edge_values = [
            f["edge_star_out"], f["edge_b2b"], f["edge_blowout"],
            f["edge_pace"], f["edge_bad_defense"], f["edge_minutes_stability"],
            f["edge_recent_form"], f["edge_home_road"], f["edge_line_movement"],
        ]
        f["total_edges_fired"] = float(sum(1 for v in edge_values if v > 0))

    def _extract_raw_numerics(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract raw continuous numeric features."""
        line = ctx.get("line", ctx.get("prizepicks_line", 0.0))

        # Line vs. averages
        season_avg = ctx.get("season_averages", {})
        stat_type = ctx.get("stat_type", ctx.get("prop_type", ""))
        stat_key = self._stat_type_to_key(stat_type)
        avg_season = float(season_avg.get(stat_key, 0.0))

        l5 = ctx.get("last_5_averages", {})
        avg_l5 = float(l5.get(stat_key, avg_season))

        l10 = ctx.get("last_10_averages", {})
        avg_l10 = float(l10.get(stat_key, avg_season))

        # Normalized line-vs-average (continuous, not binned)
        f["line_vs_avg_l10"] = (line - avg_l10) / avg_l10 if avg_l10 > 0 else 0.0
        f["line_vs_avg_l5"] = (line - avg_l5) / avg_l5 if avg_l5 > 0 else 0.0
        f["line_vs_season_avg"] = (line - avg_season) / avg_season if avg_season > 0 else 0.0

        # Pace (actual values)
        f["team_pace_actual"] = float(ctx.get("team_pace", 100.0))
        f["opp_pace_actual"] = float(ctx.get("opponent_pace", ctx.get("opp_pace", 100.0)))
        f["pace_differential"] = f["team_pace_actual"] - f["opp_pace_actual"]

        # Defense (actual values)
        f["opp_def_rating"] = float(ctx.get("opponent_def_rating", ctx.get("opp_def_rating", 110.0)))
        f["opp_pts_allowed_to_pos"] = float(ctx.get("opp_pts_allowed_to_pos", 0.0))
        f["player_vs_opp_hist_avg"] = float(ctx.get("player_vs_opp_hist_avg", 0.0))

        # Minutes (actual values from game logs)
        game_logs = ctx.get("game_logs", [])
        minutes_l10, minutes_l5 = self._extract_minutes_stats(game_logs)
        f["minutes_avg_l10"] = minutes_l10.get("avg", float(ctx.get("projected_minutes", 30.0)))
        f["minutes_avg_l5"] = minutes_l5.get("avg", f["minutes_avg_l10"])
        f["minutes_floor_l10"] = minutes_l10.get("floor", f["minutes_avg_l10"] - 5.0)
        f["minutes_stdev_l10"] = minutes_l10.get("stdev", 3.0)

        # Home/away split magnitude
        home_avg = ctx.get("home_averages", {}).get(stat_key, 0.0)
        away_avg = ctx.get("away_averages", {}).get(stat_key, 0.0)
        f["home_away_diff"] = float(home_avg) - float(away_avg)
        combined = (float(home_avg) + float(away_avg)) / 2.0
        f["home_away_diff_pct"] = f["home_away_diff"] / combined if combined > 0 else 0.0
        f["is_home"] = 1.0 if ctx.get("is_home", ctx.get("home_game", False)) else 0.0

        # Situational
        f["days_rest"] = float(ctx.get("rest_days", ctx.get("days_rest", 1)))
        f["is_b2b"] = 1.0 if ctx.get("is_b2b", False) else 0.0
        f["game_total_ou"] = float(ctx.get("vegas_total", ctx.get("game_total_ou", 225.0)))
        f["abs_spread"] = abs(float(ctx.get("vegas_spread", ctx.get("spread", 0.0))))

        # Usage
        f["usage_rate_season"] = float(ctx.get("usage_rate", ctx.get("usage_rate_season", 20.0)))
        f["usage_rate_l5"] = float(ctx.get("usage_rate_l5", f["usage_rate_season"]))
        f["usage_delta"] = f["usage_rate_l5"] - f["usage_rate_season"]

        # Historical hit rate
        f["hist_hit_rate"] = float(ctx.get("hit_rate", ctx.get("historical_hit_rate", 0.5)))

    def _extract_volatility(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract volatility features — biggest blind spot in current system."""
        game_logs = ctx.get("game_logs", [])
        stat_type = ctx.get("stat_type", ctx.get("prop_type", ""))
        stat_key = self._stat_type_to_key(stat_type)
        line = ctx.get("line", ctx.get("prizepicks_line", 0.0))

        # Get last 10 stat values
        stat_values = self._extract_stat_values(game_logs, stat_key, n=10)

        if len(stat_values) >= 3:
            arr = np.array(stat_values, dtype=float)
            mean_val = np.mean(arr)
            std_val = np.std(arr, ddof=1) if len(arr) > 1 else 0.0

            f["stdev_last_10"] = float(std_val)
            f["coeff_of_variation"] = float(std_val / mean_val) if mean_val > 0 else 0.0

            # Percentage of games over the line
            if line > 0:
                f["pct_games_over_line"] = float(np.mean(arr > line))
            else:
                f["pct_games_over_line"] = 0.5

            # IQR — robust volatility measure (less sensitive to outliers)
            q75 = np.percentile(arr, 75)
            q25 = np.percentile(arr, 25)
            f["iqr_last_10"] = float(q75 - q25)
        else:
            # Fallback: use context-provided values or defaults
            f["stdev_last_10"] = float(ctx.get("stdev_l10", 0.0))
            f["coeff_of_variation"] = float(ctx.get("coeff_of_variation", 0.3))
            f["pct_games_over_line"] = float(ctx.get("pct_games_over_line", 0.5))
            f["iqr_last_10"] = float(ctx.get("iqr_last_10", 0.0))

    def _extract_line_movement(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract line movement as numeric features."""
        opening = ctx.get("opening_line", ctx.get("line_open", None))
        current = ctx.get("current_line", ctx.get("line_current", ctx.get("line", None)))

        if opening is not None and current is not None:
            opening = float(opening)
            current = float(current)
            move = current - opening
            f["line_move_direction"] = float(np.sign(move))  # +1 up, -1 down, 0 flat
            f["line_move_magnitude"] = abs(move)
        else:
            # Try from line_movement dict
            lm = ctx.get("line_movement", {})
            if isinstance(lm, dict):
                direction = lm.get("direction", "flat")
                magnitude = float(lm.get("magnitude", 0.0))
                if direction == "up":
                    f["line_move_direction"] = 1.0
                elif direction == "down":
                    f["line_move_direction"] = -1.0
                else:
                    f["line_move_direction"] = 0.0
                f["line_move_magnitude"] = magnitude
            else:
                f["line_move_direction"] = 0.0
                f["line_move_magnitude"] = 0.0

    def _extract_clv(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract CLV tracking features."""
        # Current pick CLV (our implied prob vs closing line prob)
        f["closing_line_value"] = float(ctx.get("closing_line_value", ctx.get("clv", 0.0)))

        # Rolling CLV over last 10 picks
        historical_clv = ctx.get("historical_clv", [])
        if isinstance(historical_clv, list) and len(historical_clv) > 0:
            recent_clv = [
                float(r.get("clv", 0.0))
                for r in historical_clv[-10:]
                if isinstance(r, dict) and "clv" in r
            ]
            f["clv_l10"] = float(np.mean(recent_clv)) if recent_clv else 0.0
        else:
            f["clv_l10"] = float(ctx.get("clv_l10", 0.0))

    def _extract_meta(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract meta features (signal score, projections, etc.)."""
        f["signal_score"] = float(ctx.get("signal_score", 0.0))
        f["signal_count"] = float(ctx.get("active_signals", ctx.get("signal_count", 0)))
        f["projected_value"] = float(ctx.get("projected_value", 0.0))
        f["projected_minutes"] = float(ctx.get("projected_minutes", 30.0))

    # ------------------------------------------------------------------
    # Group 7-9: New feature extraction methods
    # ------------------------------------------------------------------

    def _extract_matchup_features(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract matchup-specific features — position defense, pace rank, expected pace."""
        # Opponent defensive rank vs player's position (1-30, normalized to 0-1)
        # Lower rank = better defense (1 = best, 30 = worst)
        pos_def_rank = ctx.get("opp_pos_def_rank", ctx.get("opp_position_defense_rank", 15))
        f["opp_pos_def_rank"] = float(pos_def_rank) / 30.0  # Normalize 0-1

        # Player matchup edge: historical avg vs opponent minus line, normalized
        hist_avg = f.get("player_vs_opp_hist_avg", 0.0)
        line = ctx.get("line", ctx.get("prizepicks_line", 0.0))
        if line > 0 and hist_avg > 0:
            f["player_matchup_edge"] = (hist_avg - line) / line
        else:
            f["player_matchup_edge"] = 0.0

        # Opponent pace rank (1-30, normalized to 0-1; 1 = fastest)
        pace_rank = ctx.get("opp_pace_rank", 15)
        f["opp_pace_rank"] = float(pace_rank) / 30.0

        # Expected game pace: average of team + opponent pace
        team_pace = f.get("team_pace_actual", 100.0)
        opp_pace = f.get("opp_pace_actual", 100.0)
        f["expected_game_pace"] = (team_pace + opp_pace) / 2.0

    def _extract_trend_features(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract trend/momentum features — slopes, streaks, recency."""
        game_logs = ctx.get("game_logs", [])
        stat_type = ctx.get("stat_type", ctx.get("prop_type", ""))
        stat_key = self._stat_type_to_key(stat_type)
        line = ctx.get("line", ctx.get("prizepicks_line", 0.0))

        stat_values_l10 = self._extract_stat_values(game_logs, stat_key, n=10)
        stat_values_l5 = self._extract_stat_values(game_logs, stat_key, n=5)

        # Linear regression slope over last 10 games (positive = improving)
        f["trend_slope_l10"] = self._compute_trend_slope(stat_values_l10)
        f["trend_slope_l5"] = self._compute_trend_slope(stat_values_l5)

        # Consecutive recent games over the line (streak)
        streak = 0
        if stat_values_l10 and line > 0:
            for val in stat_values_l10:
                if val > line:
                    streak += 1
                else:
                    break
        f["games_above_line_streak"] = float(streak)

        # Last game delta: (last game stat - line) / line
        if stat_values_l10 and line > 0:
            f["last_game_delta"] = (stat_values_l10[0] - line) / line
        else:
            f["last_game_delta"] = 0.0

    def _extract_market_features(self, ctx: Dict[str, Any], f: Dict[str, float]) -> None:
        """Extract market/odds features — implied probability, consensus, vig."""
        # Implied probability of over from sportsbook odds
        f["implied_prob_over"] = float(ctx.get("implied_prob_over", ctx.get("implied_probability", 0.5)))

        # Current line vs consensus line across books
        consensus = ctx.get("consensus_line", ctx.get("market_consensus_line", None))
        current_line = ctx.get("line", ctx.get("prizepicks_line", 0.0))
        if consensus is not None and float(consensus) > 0:
            f["line_vs_consensus"] = current_line - float(consensus)
        else:
            f["line_vs_consensus"] = 0.0

        # Number of sportsbooks offering this prop (liquidity/confidence proxy)
        f["num_books_offering"] = float(ctx.get("num_books_offering", ctx.get("sportsbook_count", 0)))

        # Vig magnitude (total overround — high vig = uncertain market)
        f["vig_magnitude"] = float(ctx.get("vig_magnitude", ctx.get("total_vig", 0.0)))

    @staticmethod
    def _compute_trend_slope(values: List[float]) -> float:
        """Compute linear regression slope over a sequence of stat values.
        Values are ordered most-recent-first, so we reverse for regression.
        Returns slope per game (positive = trending up)."""
        if len(values) < 3:
            return 0.0
        # Reverse so index 0 = oldest game
        y = np.array(list(reversed(values)), dtype=float)
        x = np.arange(len(y), dtype=float)
        try:
            coeffs = np.polyfit(x, y, 1)
            return float(coeffs[0])  # slope
        except (np.linalg.LinAlgError, ValueError):
            return 0.0

    # ------------------------------------------------------------------
    # Utility methods
    # ------------------------------------------------------------------

    @staticmethod
    def _stat_type_to_key(stat_type: str) -> str:
        """Map stat type names to the key used in averages dicts."""
        mapping = {
            "Points": "pts", "points": "pts", "PTS": "pts",
            "Rebounds": "reb", "rebounds": "reb", "REB": "reb",
            "Assists": "ast", "assists": "ast", "AST": "ast",
            "3-Pointers Made": "fg3m", "threes": "fg3m", "3PM": "fg3m",
            "Pts+Rebs+Asts": "pra", "pts_reb_ast": "pra", "PRA": "pra",
            "Steals": "stl", "steals": "stl", "STL": "stl",
            "Blocks": "blk", "blocks": "blk", "BLK": "blk",
            "Turnovers": "tov", "turnovers": "tov", "TOV": "tov",
        }
        return mapping.get(stat_type, stat_type.lower()[:3])

    @staticmethod
    def _extract_minutes_stats(game_logs: Any, n: int = 10) -> Tuple[Dict[str, float], Dict[str, float]]:
        """Extract minutes statistics from game logs."""
        empty = {"avg": 0.0, "stdev": 0.0, "floor": 0.0}

        if not game_logs:
            return empty, empty

        # Handle both list-of-dicts and DataFrame
        minutes = []
        if isinstance(game_logs, list):
            for g in game_logs[:n]:
                m = g.get("MIN", g.get("minutes", None))
                if m is not None and float(m) > 0:
                    minutes.append(float(m))
        else:
            # Assume DataFrame-like
            try:
                col = game_logs["MIN"] if "MIN" in game_logs.columns else game_logs.get("minutes")
                minutes = [float(m) for m in col.head(n).dropna() if float(m) > 0]
            except Exception:
                return empty, empty

        if not minutes:
            return empty, empty

        l10 = minutes[:10]
        l5 = minutes[:5]

        def _stats(vals: List[float]) -> Dict[str, float]:
            if not vals:
                return empty
            arr = np.array(vals)
            return {
                "avg": float(np.mean(arr)),
                "stdev": float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0,
                "floor": float(np.min(arr)),
            }

        return _stats(l10), _stats(l5)

    @staticmethod
    def _extract_stat_values(game_logs: Any, stat_key: str, n: int = 10) -> List[float]:
        """Extract stat values from game logs."""
        if not game_logs:
            return []

        # Map stat keys to game log column names
        col_map = {
            "pts": ["PTS", "points", "pts"],
            "reb": ["REB", "rebounds", "reb"],
            "ast": ["AST", "assists", "ast"],
            "fg3m": ["FG3M", "threes", "fg3m", "3PM"],
            "stl": ["STL", "steals", "stl"],
            "blk": ["BLK", "blocks", "blk"],
            "tov": ["TOV", "turnovers", "tov"],
            "pra": ["PRA", "pts_reb_ast"],
        }
        possible_keys = col_map.get(stat_key, [stat_key])

        values = []
        if isinstance(game_logs, list):
            for g in game_logs[:n]:
                for key in possible_keys:
                    val = g.get(key)
                    if val is not None:
                        values.append(float(val))
                        break
                # For PRA, compute from components
                if stat_key == "pra" and not values:
                    pts = g.get("PTS", g.get("pts", 0))
                    reb = g.get("REB", g.get("reb", 0))
                    ast = g.get("AST", g.get("ast", 0))
                    if pts or reb or ast:
                        values.append(float(pts or 0) + float(reb or 0) + float(ast or 0))
        else:
            # DataFrame-like
            try:
                for key in possible_keys:
                    if key in game_logs.columns:
                        vals = game_logs[key].head(n).dropna().tolist()
                        values = [float(v) for v in vals]
                        break
            except Exception:
                pass

        return values

    def _compute_target(self, ctx: Dict[str, Any]) -> Optional[int]:
        """Compute binary target if actual result is available."""
        actual = ctx.get("actual_value")
        line = ctx.get("line", ctx.get("prizepicks_line"))

        if actual is not None and line is not None:
            return int(float(actual) > float(line))
        return None
