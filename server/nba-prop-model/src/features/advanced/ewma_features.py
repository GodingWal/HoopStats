"""
EWMA (Exponentially Weighted Moving Average) Feature Engineering

Replaces simple rolling averages with EWMA that gives exponentially
more weight to recent games. This captures recent form better than
equal-weighted windows and naturally handles schedule gaps.

Key features:
- EWMA with configurable half-life (3, 5, 10 game decay)
- EWMA variance for consistency/volatility modeling
- Hot/cold streak detection via EWMA delta
- Per-minute EWMA rates (minutes-adjusted)
- Lagged features to avoid lookahead bias
"""

from typing import Dict, List, Optional, Tuple
import numpy as np
import pandas as pd


class EWMAFeatureEngineer:
    """
    Compute EWMA-based rolling features from game logs.

    Uses exponential decay instead of simple moving averages,
    giving more weight to recent performance while still
    incorporating history.
    """

    # Half-life in games for different decay speeds
    FAST_HALFLIFE = 3    # Reacts quickly to recent form
    MEDIUM_HALFLIFE = 5  # Balanced recency/stability
    SLOW_HALFLIFE = 10   # Stable baseline estimate

    # Stats to compute EWMA for
    CORE_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "TOV", "MIN"]
    EFFICIENCY_STATS = ["FGM", "FGA", "FTM", "FTA", "FG3A"]

    def __init__(self):
        pass

    def compute_ewma_features(
        self,
        game_log: pd.DataFrame,
        stat_type: str = "PTS",
    ) -> Dict[str, float]:
        """
        Compute full EWMA feature set from a player's game log.

        Args:
            game_log: DataFrame with game stats, most recent first.
            stat_type: Primary stat being projected.

        Returns:
            Dict of EWMA feature name -> value.
        """
        df = self._prepare_log(game_log)
        if len(df) < 3:
            return self._default_features(stat_type)

        features = {}

        # EWMA means at different decay rates
        for stat in self.CORE_STATS:
            if stat not in df.columns:
                continue
            series = df[stat].values.astype(float)

            ewma_fast = self._ewma(series, self.FAST_HALFLIFE)
            ewma_med = self._ewma(series, self.MEDIUM_HALFLIFE)
            ewma_slow = self._ewma(series, self.SLOW_HALFLIFE)

            features[f"ewma_{stat.lower()}_fast"] = ewma_fast
            features[f"ewma_{stat.lower()}_medium"] = ewma_med
            features[f"ewma_{stat.lower()}_slow"] = ewma_slow

            # EWMA variance (volatility at each timescale)
            ewma_var_fast = self._ewma_variance(series, self.FAST_HALFLIFE)
            ewma_var_med = self._ewma_variance(series, self.MEDIUM_HALFLIFE)
            features[f"ewma_{stat.lower()}_var_fast"] = ewma_var_fast
            features[f"ewma_{stat.lower()}_var_medium"] = ewma_var_med

            # Momentum: fast EWMA minus slow EWMA (positive = trending up)
            features[f"ewma_{stat.lower()}_momentum"] = ewma_fast - ewma_slow

            # Acceleration: rate of change of momentum
            if len(series) >= 5:
                momentum_series = self._ewma_series(series, self.FAST_HALFLIFE) - \
                                  self._ewma_series(series, self.SLOW_HALFLIFE)
                features[f"ewma_{stat.lower()}_accel"] = float(
                    momentum_series[0] - momentum_series[min(2, len(momentum_series) - 1)]
                )
            else:
                features[f"ewma_{stat.lower()}_accel"] = 0.0

        # Per-minute EWMA rates
        if "MIN" in df.columns:
            min_series = df["MIN"].values.astype(float)
            min_ewma = max(self._ewma(min_series, self.MEDIUM_HALFLIFE), 1.0)

            for stat in ["PTS", "REB", "AST", "FG3M", "STL", "BLK"]:
                if stat not in df.columns:
                    continue
                stat_ewma = self._ewma(df[stat].values.astype(float), self.MEDIUM_HALFLIFE)
                features[f"ewma_{stat.lower()}_per_min"] = stat_ewma / min_ewma

        # Hot/cold streak detection for the target stat
        if stat_type.upper() in df.columns:
            target_series = df[stat_type.upper()].values.astype(float)
            features.update(self._streak_features(target_series, stat_type))

        # Rolling window variance (for alternate lines / blowout risk)
        features.update(self._rolling_variance_features(df, stat_type))

        return features

    def compute_ewma_for_backtesting(
        self,
        game_log: pd.DataFrame,
        stat: str = "PTS",
    ) -> pd.DataFrame:
        """
        Compute EWMA features at each game for backtesting.
        Uses only prior data (shifted) to avoid lookahead.

        Returns DataFrame with EWMA columns added.
        """
        df = self._prepare_log(game_log).sort_values("GAME_DATE")
        if len(df) < 2:
            return df

        series = df[stat].values.astype(float)

        # Compute EWMA at each point using only prior games
        for halflife, label in [(3, "fast"), (5, "medium"), (10, "slow")]:
            alpha = 1 - np.exp(-np.log(2) / halflife)
            ewma_vals = np.zeros(len(series))
            ewma_vals[0] = series[0]
            for i in range(1, len(series)):
                ewma_vals[i] = alpha * series[i] + (1 - alpha) * ewma_vals[i - 1]

            # Shift to avoid lookahead
            shifted = np.roll(ewma_vals, 1)
            shifted[0] = np.nan
            df[f"ewma_{stat.lower()}_{label}"] = shifted

        return df

    # ------------------------------------------------------------------
    # Core EWMA computations
    # ------------------------------------------------------------------

    @staticmethod
    def _ewma(values: np.ndarray, halflife: int) -> float:
        """
        Compute EWMA of a series (most recent value first).
        Returns the current EWMA estimate.
        """
        if len(values) == 0:
            return 0.0
        alpha = 1 - np.exp(-np.log(2) / halflife)
        result = values[0]
        for i in range(1, len(values)):
            result = alpha * values[i] + (1 - alpha) * result
            # Since values[0] is most recent, we weight backwards
        # Actually, for most-recent-first ordering, reverse the computation
        result = values[-1]
        for i in range(len(values) - 2, -1, -1):
            result = alpha * values[i] + (1 - alpha) * result
        return float(result)

    @staticmethod
    def _ewma_series(values: np.ndarray, halflife: int) -> np.ndarray:
        """Compute EWMA series (most recent first ordering)."""
        if len(values) == 0:
            return np.array([])
        alpha = 1 - np.exp(-np.log(2) / halflife)
        result = np.zeros_like(values, dtype=float)
        result[-1] = values[-1]
        for i in range(len(values) - 2, -1, -1):
            result[i] = alpha * values[i] + (1 - alpha) * result[i + 1]
        return result

    @staticmethod
    def _ewma_variance(values: np.ndarray, halflife: int) -> float:
        """
        Compute EWMA variance (exponentially weighted variance).
        Measures recent volatility with more weight on recent deviations.
        """
        if len(values) < 3:
            return 0.0
        alpha = 1 - np.exp(-np.log(2) / halflife)
        # Compute EWMA mean first
        mean = values[-1]
        for i in range(len(values) - 2, -1, -1):
            mean = alpha * values[i] + (1 - alpha) * mean
        # Compute EWMA variance
        var = (values[-1] - mean) ** 2
        for i in range(len(values) - 2, -1, -1):
            var = alpha * (values[i] - mean) ** 2 + (1 - alpha) * var
        return float(var)

    # ------------------------------------------------------------------
    # Streak and variance features
    # ------------------------------------------------------------------

    def _streak_features(
        self, values: np.ndarray, stat_type: str
    ) -> Dict[str, float]:
        """Detect hot/cold streaks using EWMA crossover."""
        prefix = f"streak_{stat_type.lower()}"
        features = {}

        if len(values) < 5:
            features[f"{prefix}_hot_cold"] = 0.0
            features[f"{prefix}_consistency"] = 0.0
            features[f"{prefix}_zscore_recent"] = 0.0
            return features

        fast_ewma = self._ewma(values, self.FAST_HALFLIFE)
        slow_ewma = self._ewma(values, self.SLOW_HALFLIFE)

        # Hot/cold: how far fast EWMA is above/below slow
        if slow_ewma > 0:
            features[f"{prefix}_hot_cold"] = (fast_ewma - slow_ewma) / slow_ewma
        else:
            features[f"{prefix}_hot_cold"] = 0.0

        # Consistency: inverse of coefficient of variation (recent)
        recent_std = np.std(values[:5])
        recent_mean = np.mean(values[:5])
        if recent_mean > 0:
            features[f"{prefix}_consistency"] = 1.0 - min(recent_std / recent_mean, 1.0)
        else:
            features[f"{prefix}_consistency"] = 0.0

        # Z-score of most recent game vs EWMA
        ewma_var = self._ewma_variance(values, self.MEDIUM_HALFLIFE)
        ewma_std = np.sqrt(max(ewma_var, 0.01))
        features[f"{prefix}_zscore_recent"] = (values[0] - fast_ewma) / ewma_std

        return features

    def _rolling_variance_features(
        self, df: pd.DataFrame, stat_type: str
    ) -> Dict[str, float]:
        """Rolling window variance features for blowout risk / alt lines."""
        features = {}
        stat_col = stat_type.upper()
        if stat_col not in df.columns:
            return features

        values = df[stat_col].values.astype(float)

        # 5-game and 10-game rolling variance
        if len(values) >= 5:
            features["rolling_var_5"] = float(np.var(values[:5], ddof=1))
            features["rolling_range_5"] = float(np.max(values[:5]) - np.min(values[:5]))
        else:
            features["rolling_var_5"] = 0.0
            features["rolling_range_5"] = 0.0

        if len(values) >= 10:
            features["rolling_var_10"] = float(np.var(values[:10], ddof=1))
            features["rolling_range_10"] = float(np.max(values[:10]) - np.min(values[:10]))
            # Skewness (positive = upside risk, negative = downside risk)
            mean_10 = np.mean(values[:10])
            std_10 = np.std(values[:10], ddof=1)
            if std_10 > 0:
                features["rolling_skew_10"] = float(
                    np.mean(((values[:10] - mean_10) / std_10) ** 3)
                )
            else:
                features["rolling_skew_10"] = 0.0
        else:
            features["rolling_var_10"] = 0.0
            features["rolling_range_10"] = 0.0
            features["rolling_skew_10"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _prepare_log(self, game_log: pd.DataFrame) -> pd.DataFrame:
        """Prepare game log for processing."""
        df = game_log.copy()
        if "MIN" in df.columns and df["MIN"].dtype == "object":
            df["MIN"] = df["MIN"].apply(self._parse_minutes)
        numeric_cols = self.CORE_STATS + self.EFFICIENCY_STATS + ["OREB", "DREB", "PF"]
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        df = df[df.get("MIN", pd.Series([1])) > 0]
        return df

    @staticmethod
    def _parse_minutes(val) -> float:
        if pd.isna(val):
            return 0.0
        if isinstance(val, (int, float)):
            return float(val)
        if ":" in str(val):
            parts = str(val).split(":")
            return float(parts[0]) + float(parts[1]) / 60
        return float(val)

    def _default_features(self, stat_type: str) -> Dict[str, float]:
        """Return zero-filled default features when insufficient data."""
        features = {}
        for stat in self.CORE_STATS:
            s = stat.lower()
            for label in ["fast", "medium", "slow"]:
                features[f"ewma_{s}_{label}"] = 0.0
            for label in ["fast", "medium"]:
                features[f"ewma_{s}_var_{label}"] = 0.0
            features[f"ewma_{s}_momentum"] = 0.0
            features[f"ewma_{s}_accel"] = 0.0
        for stat in ["PTS", "REB", "AST", "FG3M", "STL", "BLK"]:
            features[f"ewma_{stat.lower()}_per_min"] = 0.0
        prefix = f"streak_{stat_type.lower()}"
        features[f"{prefix}_hot_cold"] = 0.0
        features[f"{prefix}_consistency"] = 0.0
        features[f"{prefix}_zscore_recent"] = 0.0
        features["rolling_var_5"] = 0.0
        features["rolling_range_5"] = 0.0
        features["rolling_var_10"] = 0.0
        features["rolling_range_10"] = 0.0
        features["rolling_skew_10"] = 0.0
        return features
