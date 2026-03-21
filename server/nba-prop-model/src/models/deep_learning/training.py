"""
Deep Learning Training Pipeline

Trains PropNet models using historical projection logs from the database.

Training data schema (matches projection_logs table):
    player_id, player_name, stat_type, game_date, opponent,
    projected_value, actual_value, line,
    context_json (full context dict with season_averages, signal_adjustments, etc.),
    game_log_json (list of recent game dicts)

Usage:
    pipeline = DLTrainingPipeline(stat_types=["Points", "Rebounds", "Assists"])
    pipeline.load_examples_from_db(db_rows)
    results = pipeline.train_all()
    pipeline.save_all_models(model_store)
"""

from __future__ import annotations
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from .prop_net import (
    PropNet,
    PropNetConfig,
    SEQ_DIM,
    STATIC_DIM,
    build_sequence_from_game_log,
    build_static_features,
)
from .model_store import ModelStore

logger = logging.getLogger(__name__)

SUPPORTED_STAT_TYPES = [
    "Points",
    "Rebounds",
    "Assists",
    "3-Pointers Made",
    "Pts+Rebs+Asts",
    "Steals",
    "Blocks",
]


# ---------------------------------------------------------------------------
# Training example
# ---------------------------------------------------------------------------

@dataclass
class TrainingExample:
    """One labelled row from projection_logs."""
    stat_type: str
    sequence: np.ndarray        # (seq_len, SEQ_DIM)
    static: np.ndarray          # (STATIC_DIM,)
    actual: float               # Ground-truth stat value
    analytical_projection: float


# ---------------------------------------------------------------------------
# Training config
# ---------------------------------------------------------------------------

@dataclass
class TrainingConfig:
    """Hyperparameters for the training loop."""
    epochs: int = 50
    batch_size: int = 32
    learning_rate: float = 5e-4
    lr_decay: float = 0.98          # Multiply lr by this every epoch
    min_lr: float = 1e-5
    val_split: float = 0.15         # Fraction held out for validation
    early_stopping_patience: int = 8
    min_examples: int = 50          # Skip stat types with fewer examples
    seq_len: int = 10               # Game sequence length
    clip_grad_norm: float = 5.0     # Gradient clipping threshold


# ---------------------------------------------------------------------------
# Epoch metrics
# ---------------------------------------------------------------------------

@dataclass
class EpochMetrics:
    epoch: int
    train_loss: float
    val_loss: float
    val_mae: float


@dataclass
class TrainingResult:
    stat_type: str
    n_train: int
    n_val: int
    best_val_loss: float
    best_val_mae: float
    epochs_trained: int
    history: List[EpochMetrics] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------

class DLTrainingPipeline:
    """
    End-to-end training pipeline.

    Typical usage:
        pipeline = DLTrainingPipeline()
        pipeline.load_examples_from_db(rows)
        results = pipeline.train_all()
        pipeline.save_all_models(store)
    """

    def __init__(
        self,
        stat_types: Optional[List[str]] = None,
        config: TrainingConfig = TrainingConfig(),
    ):
        self.stat_types = stat_types or SUPPORTED_STAT_TYPES
        self.config = config
        self._examples: Dict[str, List[TrainingExample]] = {s: [] for s in self.stat_types}
        self.models: Dict[str, PropNet] = {}

    # -----------------------------------------------------------------------
    # Data loading
    # -----------------------------------------------------------------------

    def load_examples_from_db(self, rows: List[Dict[str, Any]]):
        """
        Load and parse rows from the projection_logs table.

        Each row should have:
            stat_type, projected_value, actual_value,
            context_json (str or dict), game_log_json (str or list)
        """
        loaded = 0
        skipped = 0
        for row in rows:
            stat_type = row.get("stat_type", "")
            if stat_type not in self.stat_types:
                continue

            actual = row.get("actual_value")
            analytical = row.get("projected_value")
            if actual is None or analytical is None:
                skipped += 1
                continue

            # Parse JSON fields
            context = row.get("context_json", {})
            if isinstance(context, str):
                try:
                    context = json.loads(context)
                except json.JSONDecodeError:
                    skipped += 1
                    continue

            game_log = row.get("game_log_json", [])
            if isinstance(game_log, str):
                try:
                    game_log = json.loads(game_log)
                except json.JSONDecodeError:
                    game_log = []

            # Build arrays
            try:
                seq = build_sequence_from_game_log(
                    game_log=game_log,
                    seq_len=self.config.seq_len,
                    signal_score=_extract_signal_score(context),
                    opp_pace=context.get("opponent_pace", 100.0),
                    opp_def_rtg=context.get("opponent_def_rating", 110.0),
                    is_home=context.get("is_home", True),
                    is_b2b=context.get("is_b2b", False),
                    rest_days=context.get("rest_days", 2),
                    spread_abs=abs(context.get("vegas_spread", 0.0)),
                    total=context.get("vegas_total", 225.0),
                )
                static = build_static_features(context)
            except Exception as e:
                logger.debug("Skipping row — feature build error: %s", e)
                skipped += 1
                continue

            example = TrainingExample(
                stat_type=stat_type,
                sequence=seq.astype(np.float32),
                static=static.astype(np.float32),
                actual=float(actual),
                analytical_projection=float(analytical),
            )
            self._examples[stat_type].append(example)
            loaded += 1

        logger.info("Loaded %d training examples (%d skipped).", loaded, skipped)

    def add_example(self, example: TrainingExample):
        """Add a single example directly (for online/streaming updates)."""
        if example.stat_type in self._examples:
            self._examples[example.stat_type].append(example)

    # -----------------------------------------------------------------------
    # Training
    # -----------------------------------------------------------------------

    def train_all(self) -> Dict[str, TrainingResult]:
        """Train a PropNet for each stat type. Returns results dict."""
        results: Dict[str, TrainingResult] = {}
        for stat_type in self.stat_types:
            examples = self._examples[stat_type]
            if len(examples) < self.config.min_examples:
                logger.warning(
                    "Skipping %s — only %d examples (need %d).",
                    stat_type, len(examples), self.config.min_examples,
                )
                continue
            logger.info("Training PropNet for %s (%d examples)…", stat_type, len(examples))
            model, result = self._train_one(stat_type, examples)
            self.models[stat_type] = model
            results[stat_type] = result
            logger.info(
                "  %s done: val_loss=%.4f, val_mae=%.4f, epochs=%d",
                stat_type, result.best_val_loss, result.best_val_mae, result.epochs_trained,
            )
        return results

    def _train_one(
        self,
        stat_type: str,
        examples: List[TrainingExample],
    ) -> Tuple[PropNet, TrainingResult]:
        cfg = self.config

        # Shuffle and split
        indices = np.random.permutation(len(examples))
        n_val = max(1, int(len(examples) * cfg.val_split))
        val_idx = indices[:n_val]
        train_idx = indices[n_val:]

        train_ex = [examples[i] for i in train_idx]
        val_ex   = [examples[i] for i in val_idx]

        # Compute label normalisation from training set
        actuals = np.array([e.actual for e in train_ex])
        y_mean = actuals.mean()
        y_std  = max(actuals.std(), 1.0)

        # Build model
        net_cfg = PropNetConfig(
            seq_len=cfg.seq_len,
            stat_type=stat_type,
        )
        model = PropNet(net_cfg)

        # Prepare batched tensors
        train_seq    = np.stack([e.sequence for e in train_ex])   # (N, T, D)
        train_static = np.stack([e.static   for e in train_ex])   # (N, S)
        train_y      = np.array([e.actual   for e in train_ex], dtype=np.float32)

        val_seq    = np.stack([e.sequence for e in val_ex])
        val_static = np.stack([e.static   for e in val_ex])
        val_y      = np.array([e.actual   for e in val_ex], dtype=np.float32)

        # Normalise targets
        train_y_norm = (train_y - y_mean) / y_std
        val_y_norm   = (val_y   - y_mean) / y_std

        history: List[EpochMetrics] = []
        best_val_loss = float("inf")
        best_params   = model.get_all_params()
        best_moments  = model.get_all_moments()
        patience_left = cfg.early_stopping_patience
        lr = cfg.learning_rate
        n = len(train_ex)

        for epoch in range(cfg.epochs):
            model.train()

            # Shuffle training data each epoch
            perm = np.random.permutation(n)
            epoch_loss = 0.0
            n_batches  = 0

            for start in range(0, n, cfg.batch_size):
                batch_idx = perm[start : start + cfg.batch_size]
                bx_seq    = train_seq[batch_idx]
                bx_static = train_static[batch_idx]
                by        = train_y_norm[batch_idx].reshape(-1, 1)

                # Forward
                pred = model.forward(bx_seq, bx_static)  # (B, 1)

                # MSE loss
                diff = pred - by
                loss = float(np.mean(diff ** 2))
                epoch_loss += loss
                n_batches  += 1

                # Backward
                d_loss = 2.0 * diff / len(batch_idx)
                model.backward(d_loss)

                # Gradient clipping (clip output layer grad as proxy)
                model.adam_update(lr=lr)

            train_loss = epoch_loss / max(n_batches, 1)

            # Validation
            model.eval()
            val_pred = model.forward(val_seq, val_static)       # (N_val, 1)
            val_pred_denorm = val_pred.flatten() * y_std + y_mean
            val_loss = float(np.mean(((val_pred.flatten() - val_y_norm) ** 2)))
            val_mae  = float(np.mean(np.abs(val_pred_denorm - val_y)))

            metrics = EpochMetrics(epoch=epoch, train_loss=train_loss,
                                   val_loss=val_loss, val_mae=val_mae)
            history.append(metrics)

            if val_loss < best_val_loss:
                best_val_loss = val_loss
                best_params   = {k: v.copy() for k, v in model.get_all_params().items()}
                best_moments  = {k: v.copy() for k, v in model.get_all_moments().items()}
                patience_left = cfg.early_stopping_patience
            else:
                patience_left -= 1
                if patience_left <= 0:
                    logger.debug("  Early stopping at epoch %d", epoch)
                    break

            # LR decay
            lr = max(lr * cfg.lr_decay, cfg.min_lr)

        # Restore best weights
        model.load_all_params(best_params)
        model.load_all_moments(best_moments)
        model._step = cfg.epochs  # keep Adam step consistent
        model.is_fitted = True

        # Store normalisation params on model for inference
        model._y_mean = y_mean
        model._y_std  = y_std

        # Patch model.forward to denormalise output
        _patch_forward_denorm(model, y_mean, y_std)

        result = TrainingResult(
            stat_type=stat_type,
            n_train=len(train_ex),
            n_val=len(val_ex),
            best_val_loss=best_val_loss,
            best_val_mae=float(np.mean(np.abs(
                model.forward(val_seq, val_static).flatten() - val_y
            ))),
            epochs_trained=len(history),
            history=history,
        )
        return model, result

    # -----------------------------------------------------------------------
    # Persistence helpers
    # -----------------------------------------------------------------------

    def save_all_models(self, store: "ModelStore"):
        for stat_type, model in self.models.items():
            store.save(model, stat_type)

    def load_all_models(self, store: "ModelStore") -> Dict[str, PropNet]:
        for stat_type in self.stat_types:
            model = store.load(stat_type)
            if model is not None:
                self.models[stat_type] = model
        return self.models


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_signal_score(context: Dict[str, Any]) -> float:
    """Summarise all signal adjustments as a single score."""
    signals = context.get("signal_adjustments", {})
    if not signals:
        return 0.0
    return float(sum(signals.values()))


def _patch_forward_denorm(model: PropNet, y_mean: float, y_std: float):
    """
    Monkey-patch model.forward so its output is in the original stat scale,
    not normalised. This allows predict() to work without extra book-keeping.
    """
    original_forward = model.forward

    def denorm_forward(seq, static):
        out = original_forward(seq, static)
        return out * y_std + y_mean

    model.forward = denorm_forward  # type: ignore[method-assign]
