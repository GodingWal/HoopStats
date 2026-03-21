"""
PropNet — Hybrid LSTM + MLP Deep Learning Model for NBA Prop Predictions

Architecture:
    ┌─────────────────────────────────────────────────────────────────┐
    │  Sequence Branch              Static Branch                     │
    │  (last N game logs)           (season stats + matchup)          │
    │                                                                 │
    │  seq: (B, T, seq_dim)         static: (B, static_dim)          │
    │       ↓                                ↓                        │
    │  BatchNorm                        BatchNorm                     │
    │       ↓                                ↓                        │
    │  LSTM(hidden=32)              Dense(64, ReLU) → Dense(32, ReLU) │
    │  → final hidden (B, 32)            → (B, 32)                   │
    │       ↓                                ↓                        │
    │       └──────────── concat (B, 64) ───┘                        │
    │                          ↓                                      │
    │                   Dense(64, ReLU)                               │
    │                   Dropout(0.2)                                  │
    │                   Dense(32, ReLU)                               │
    │                   Dense(1, linear)  → stat projection           │
    └─────────────────────────────────────────────────────────────────┘

Each stat type (Points, Rebounds, Assists, 3PM …) gets its own
PropNet instance, trained independently.

Sequence features (per game):
    pts, reb, ast, fg3m, min, usg, ts_pct, opp_pace, opp_def_rtg,
    is_home, is_b2b, rest_days, spread_abs, total, signal_score

Static features:
    season_pts, season_reb, season_ast, season_fg3m,
    l5_pts, l5_reb, l5_ast, l5_fg3m,
    l10_pts, l10_reb, l10_ast, l10_fg3m,
    usage_rate, usage_rate_l5,
    ts_pct, ts_pct_l5,
    opp_pace, opp_def_rtg,
    is_home, is_b2b, rest_days, spread_abs, total,
    proj_minutes,
    signal_injury_alpha, signal_b2b, signal_pace, signal_defense,
    signal_blowout, signal_home_away, signal_recent_form,
    signal_fatigue, signal_referee, signal_line_movement,
    pts_std, reb_std, ast_std, minutes_std
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import numpy as np

from .numpy_nn import LSTMLayer, Dense, BatchNorm1D, Dropout


# ---------------------------------------------------------------------------
# Sequence and static feature definitions
# ---------------------------------------------------------------------------

SEQ_FEATURES = [
    "pts", "reb", "ast", "fg3m", "min", "usg",
    "ts_pct", "opp_pace", "opp_def_rtg",
    "is_home", "is_b2b", "rest_days",
    "spread_abs", "total", "signal_score",
]

STATIC_FEATURES = [
    "season_pts", "season_reb", "season_ast", "season_fg3m",
    "l5_pts", "l5_reb", "l5_ast", "l5_fg3m",
    "l10_pts", "l10_reb", "l10_ast", "l10_fg3m",
    "usage_rate", "usage_rate_l5",
    "ts_pct", "ts_pct_l5",
    "opp_pace", "opp_def_rtg",
    "is_home", "is_b2b", "rest_days", "spread_abs", "total",
    "proj_minutes",
    "signal_injury_alpha", "signal_b2b", "signal_pace", "signal_defense",
    "signal_blowout", "signal_home_away", "signal_recent_form",
    "signal_fatigue", "signal_referee", "signal_line_movement",
    "pts_std", "reb_std", "ast_std", "minutes_std",
]

SEQ_DIM = len(SEQ_FEATURES)       # 15
STATIC_DIM = len(STATIC_FEATURES)  # 36


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

@dataclass
class PropNetConfig:
    """Hyperparameters for PropNet."""
    seq_len: int = 10            # Number of past games in sequence
    lstm_hidden: int = 32        # LSTM hidden units
    mlp_hidden: int = 64         # MLP first hidden layer
    mlp_hidden2: int = 32        # MLP second hidden layer
    fusion_hidden: int = 64      # Fusion layer size
    fusion_hidden2: int = 32     # Second fusion layer
    dropout_rate: float = 0.2    # Dropout in fusion
    stat_type: str = "Points"    # Which stat this model targets


# ---------------------------------------------------------------------------
# Feature builder helpers
# ---------------------------------------------------------------------------

def build_sequence_from_game_log(
    game_log: List[Dict[str, Any]],
    seq_len: int = 10,
    signal_score: float = 0.0,
    opp_pace: float = 100.0,
    opp_def_rtg: float = 110.0,
    is_home: bool = True,
    is_b2b: bool = False,
    rest_days: int = 2,
    spread_abs: float = 4.0,
    total: float = 225.0,
) -> np.ndarray:
    """
    Convert a list of recent game dicts into a (seq_len, SEQ_DIM) array.

    game_log should be ordered most-recent-first. We take the last seq_len
    games and pad with zeros if fewer games are available.

    Each game dict is expected to have: PTS, REB, AST, FG3M, MIN, USG_PCT, TS_PCT
    """
    arr = np.zeros((seq_len, SEQ_DIM))
    games = game_log[:seq_len]  # most recent seq_len games

    for i, g in enumerate(reversed(games)):  # oldest → newest
        row_idx = seq_len - len(games) + i  # pad beginning with zeros
        arr[row_idx, 0]  = float(g.get("PTS", g.get("pts", 0)))
        arr[row_idx, 1]  = float(g.get("REB", g.get("reb", 0)))
        arr[row_idx, 2]  = float(g.get("AST", g.get("ast", 0)))
        arr[row_idx, 3]  = float(g.get("FG3M", g.get("fg3m", 0)))
        arr[row_idx, 4]  = float(g.get("MIN", g.get("min", 30)))
        arr[row_idx, 5]  = float(g.get("USG_PCT", g.get("usg", 0.2)))
        arr[row_idx, 6]  = float(g.get("TS_PCT", g.get("ts_pct", 0.55)))
        # Future context features (same for all steps — represent tonight's game)
        arr[row_idx, 7]  = opp_pace
        arr[row_idx, 8]  = opp_def_rtg
        arr[row_idx, 9]  = float(is_home)
        arr[row_idx, 10] = float(is_b2b)
        arr[row_idx, 11] = float(rest_days)
        arr[row_idx, 12] = spread_abs
        arr[row_idx, 13] = total
        arr[row_idx, 14] = signal_score

    return arr


def build_static_features(context: Dict[str, Any]) -> np.ndarray:
    """Build a (STATIC_DIM,) feature vector from a context dict."""
    s = context.get("season_averages", {})
    l5 = context.get("last_5_averages", {})
    l10 = context.get("last_10_averages", {})
    signals = context.get("signal_adjustments", {})
    features_ctx = context.get("player_features", {})

    vec = np.array([
        s.get("pts", 0.0), s.get("reb", 0.0), s.get("ast", 0.0), s.get("fg3m", 0.0),
        l5.get("pts", 0.0), l5.get("reb", 0.0), l5.get("ast", 0.0), l5.get("fg3m", 0.0),
        l10.get("pts", 0.0), l10.get("reb", 0.0), l10.get("ast", 0.0), l10.get("fg3m", 0.0),
        features_ctx.get("usage_rate", 0.2),
        features_ctx.get("usage_rate_l5", 0.2),
        features_ctx.get("ts_pct", 0.55),
        features_ctx.get("ts_pct_l5", 0.55),
        context.get("opponent_pace", 100.0),
        context.get("opponent_def_rating", 110.0),
        float(context.get("is_home", True)),
        float(context.get("is_b2b", False)),
        float(context.get("rest_days", 2)),
        abs(context.get("vegas_spread", 0.0)),
        context.get("vegas_total", 225.0),
        context.get("projected_minutes", 30.0),
        signals.get("injury_alpha", 0.0),
        signals.get("b2b", 0.0),
        signals.get("pace", 0.0),
        signals.get("defense", 0.0),
        signals.get("blowout", 0.0),
        signals.get("home_away", 0.0),
        signals.get("recent_form", 0.0),
        signals.get("fatigue", 0.0),
        signals.get("referee", 0.0),
        signals.get("line_movement", 0.0),
        features_ctx.get("pts_std", 5.0),
        features_ctx.get("reb_std", 2.0),
        features_ctx.get("ast_std", 1.5),
        features_ctx.get("minutes_std", 4.0),
    ], dtype=np.float32)

    # Clip extreme values
    vec = np.clip(vec, -100.0, 200.0)
    return vec


# ---------------------------------------------------------------------------
# DLPrediction output
# ---------------------------------------------------------------------------

@dataclass
class DLPrediction:
    """Output from PropNet.predict()."""
    stat_type: str
    projection: float         # Raw projected value
    prob_over: float          # P(actual > line)
    prob_under: float         # P(actual < line)
    line: Optional[float]     # Betting line (if provided)
    confidence: float         # [0, 1] — model self-assessed confidence
    dl_adjustment: float      # How much DL shifted from analytical baseline


# ---------------------------------------------------------------------------
# PropNet model
# ---------------------------------------------------------------------------

class PropNet:
    """
    Hybrid LSTM + MLP model for a single stat type.

    Call flow:
        net = PropNet(config)
        pred = net.predict(sequence, static, analytical_projection, line=21.5)
    """

    def __init__(self, config: PropNetConfig = PropNetConfig()):
        self.config = config
        self.stat_type = config.stat_type
        self.is_fitted = False

        H = config.lstm_hidden
        M = config.mlp_hidden
        M2 = config.mlp_hidden2
        F = config.fusion_hidden
        F2 = config.fusion_hidden2

        # --- Sequence branch ---
        self.seq_bn = BatchNorm1D(SEQ_DIM, name="seq_bn")
        self.lstm = LSTMLayer(SEQ_DIM, H, name="lstm")

        # --- Static branch ---
        self.static_bn = BatchNorm1D(STATIC_DIM, name="static_bn")
        self.mlp1 = Dense(STATIC_DIM, M, activation="relu", name="mlp1")
        self.mlp2 = Dense(M, M2, activation="relu", name="mlp2")

        # --- Fusion ---
        fusion_in = H + M2
        self.fusion1   = Dense(fusion_in, F,  activation="relu", name="fusion1")
        self.dropout    = Dropout(config.dropout_rate)
        self.fusion2   = Dense(F, F2, activation="relu", name="fusion2")
        self.out_layer = Dense(F2, 1, activation="linear", name="output")

        self._layers = [
            self.seq_bn, self.lstm,
            self.static_bn, self.mlp1, self.mlp2,
            self.fusion1, self.fusion2, self.out_layer,
        ]
        self._step = 0  # Adam step counter

    # -----------------------------------------------------------------------
    # Forward pass
    # -----------------------------------------------------------------------

    def forward(
        self,
        seq: np.ndarray,     # (batch, seq_len, SEQ_DIM)
        static: np.ndarray,  # (batch, STATIC_DIM)
    ) -> np.ndarray:
        """Returns raw output: (batch, 1)."""
        # Sequence branch
        batch, T, D = seq.shape
        seq_flat = seq.reshape(-1, D)
        seq_normed = self.seq_bn.forward(seq_flat).reshape(batch, T, D)
        lstm_out = self.lstm.forward(seq_normed)      # (batch, H)

        # Static branch
        static_normed = self.static_bn.forward(static)
        mlp_out = self.mlp1.forward(static_normed)
        mlp_out = self.mlp2.forward(mlp_out)          # (batch, M2)

        # Fusion
        fused = np.concatenate([lstm_out, mlp_out], axis=-1)  # (batch, H+M2)
        out = self.fusion1.forward(fused)
        out = self.dropout.forward(out)
        out = self.fusion2.forward(out)
        out = self.out_layer.forward(out)              # (batch, 1)
        return out

    # -----------------------------------------------------------------------
    # Backward pass
    # -----------------------------------------------------------------------

    def backward(self, d_out: np.ndarray) -> None:
        """Backprop through all layers."""
        # Output → fusion2
        d = self.out_layer.backward(d_out)
        d = self.fusion2.backward(d)
        d = self.dropout.backward(d)
        d = self.fusion1.backward(d)

        # Split gradient for LSTM and MLP branches
        H = self.config.lstm_hidden
        M2 = self.config.mlp_hidden2
        d_lstm_out = d[:, :H]
        d_mlp_out  = d[:, H:]

        # MLP branch backward
        d_mlp = self.mlp2.backward(d_mlp_out)
        d_mlp = self.mlp1.backward(d_mlp)
        self.static_bn.backward(d_mlp)

        # LSTM branch backward
        d_seq = self.lstm.backward(d_lstm_out)
        batch, T, D = d_seq.shape
        self.seq_bn.backward(d_seq.reshape(-1, D))

    # -----------------------------------------------------------------------
    # Adam update
    # -----------------------------------------------------------------------

    def adam_update(self, lr: float = 1e-3):
        self._step += 1
        t = self._step
        for layer in self._layers:
            if hasattr(layer, "adam_update"):
                layer.adam_update(t, lr=lr)

    # -----------------------------------------------------------------------
    # Training mode toggle
    # -----------------------------------------------------------------------

    def train(self):
        self.dropout.training = True
        self.seq_bn.training = True
        self.static_bn.training = True

    def eval(self):
        self.dropout.training = False
        self.seq_bn.training = False
        self.static_bn.training = False

    # -----------------------------------------------------------------------
    # Public API
    # -----------------------------------------------------------------------

    def predict(
        self,
        sequence: np.ndarray,           # (seq_len, SEQ_DIM) or (B, seq_len, SEQ_DIM)
        static: np.ndarray,             # (STATIC_DIM,) or (B, STATIC_DIM)
        analytical_projection: float,
        line: Optional[float] = None,
    ) -> DLPrediction:
        """
        Generate a prediction for one player-game.

        Args:
            sequence: Recent game log array built by build_sequence_from_game_log()
            static: Static feature vector built by build_static_features()
            analytical_projection: Output from the existing analytical engine
            line: Betting line for probability calculation

        Returns:
            DLPrediction with projection, probabilities, and confidence
        """
        self.eval()

        # Ensure batch dimension
        if sequence.ndim == 2:
            sequence = sequence[np.newaxis]
        if static.ndim == 1:
            static = static[np.newaxis]

        raw = self.forward(sequence, static)  # (1, 1)
        dl_proj = float(raw[0, 0])

        # Blend DL with analytical (conservative — DL adjusts, not replaces)
        # When untrained, dl_proj ≈ 0, so projection stays near analytical
        if self.is_fitted:
            projection = dl_proj
        else:
            # Fall back to analytical if not trained
            projection = analytical_projection

        dl_adjustment = projection - analytical_projection

        # Estimate variance for probability calculation
        stat_cv = {
            "Points": 0.30, "Rebounds": 0.35, "Assists": 0.40,
            "3-Pointers Made": 0.60, "Pts+Rebs+Asts": 0.25,
            "Steals": 0.70, "Blocks": 0.80,
        }
        cv = stat_cv.get(self.stat_type, 0.35)
        std = max(projection * cv, 0.5)

        prob_over = 0.5
        prob_under = 0.5
        if line is not None and std > 0:
            # Normal CDF via erf
            z = (projection - line) / (std * np.sqrt(2))
            prob_over = float(0.5 * (1 + _erf(z)))
            prob_under = 1.0 - prob_over

        # Confidence: higher when DL adjustment is small (model agrees with analytical)
        if analytical_projection > 0:
            rel_adj = abs(dl_adjustment) / analytical_projection
            confidence = max(0.3, 1.0 - rel_adj * 2.0) if self.is_fitted else 0.3
        else:
            confidence = 0.3

        return DLPrediction(
            stat_type=self.stat_type,
            projection=projection,
            prob_over=prob_over,
            prob_under=prob_under,
            line=line,
            confidence=confidence,
            dl_adjustment=dl_adjustment,
        )

    # -----------------------------------------------------------------------
    # Parameter serialisation helpers (used by ModelStore)
    # -----------------------------------------------------------------------

    def get_all_params(self) -> Dict[str, np.ndarray]:
        params: Dict[str, np.ndarray] = {}
        for layer in self._layers:
            if hasattr(layer, "params"):
                params.update(layer.params)
        return params

    def get_all_moments(self) -> Dict[str, np.ndarray]:
        moments: Dict[str, np.ndarray] = {}
        for layer in self._layers:
            if hasattr(layer, "moment_state"):
                moments.update(layer.moment_state)
        return moments

    def load_all_params(self, state: Dict[str, np.ndarray]):
        for layer in self._layers:
            if hasattr(layer, "load_params"):
                try:
                    layer.load_params(state)
                except KeyError:
                    pass  # Layer not in checkpoint — skip

    def load_all_moments(self, state: Dict[str, np.ndarray]):
        for layer in self._layers:
            if hasattr(layer, "load_moments"):
                try:
                    layer.load_moments(state)
                except KeyError:
                    pass


# ---------------------------------------------------------------------------
# Numerics helper
# ---------------------------------------------------------------------------

def _erf(x: float) -> float:
    """Approximation of the error function (Abramowitz & Stegun)."""
    a1, a2, a3, a4, a5 = 0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429
    p = 0.3275911
    sign = 1 if x >= 0 else -1
    x = abs(x)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (a1*t + a2*t**2 + a3*t**3 + a4*t**4 + a5*t**5) * np.exp(-x*x)
    return sign * float(y)
