"""
Model Store — save and load PropNet weights.

Uses np.savez_compressed so everything stays in a single .npz file
per stat type. No pickle, no external dependencies.

File naming:
    <base_dir>/propnet_<stat_slug>.npz

where stat_slug is the stat type with spaces replaced by underscores,
e.g. "propnet_3-Pointers_Made.npz".

The .npz archive contains:
    - All network weight arrays (from model.get_all_params())
    - Adam moment arrays (from model.get_all_moments())
    - Scalar metadata: y_mean, y_std, adam_step, stat_type
    - Config scalars: seq_len, lstm_hidden, …
"""

from __future__ import annotations
import logging
import os
from pathlib import Path
from typing import Optional

import numpy as np

from .prop_net import PropNet, PropNetConfig

logger = logging.getLogger(__name__)

DEFAULT_MODEL_DIR = Path(__file__).parent.parent.parent.parent / "model_weights"


class ModelStore:
    """
    Filesystem store for PropNet weights.

    Example:
        store = ModelStore("/path/to/weights")
        store.save(model, "Points")
        model = store.load("Points")
    """

    def __init__(self, base_dir: Optional[str] = None):
        self.base_dir = Path(base_dir) if base_dir else DEFAULT_MODEL_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, stat_type: str) -> Path:
        slug = stat_type.replace(" ", "_")
        return self.base_dir / f"propnet_{slug}.npz"

    # -----------------------------------------------------------------------
    # Save
    # -----------------------------------------------------------------------

    def save(self, model: PropNet, stat_type: str):
        """Persist model weights and metadata to disk."""
        path = self._path(stat_type)
        params  = model.get_all_params()
        moments = model.get_all_moments()

        # Scalar metadata stored as 0-d arrays
        meta = {
            "__y_mean__":       np.array(getattr(model, "_y_mean", 0.0)),
            "__y_std__":        np.array(getattr(model, "_y_std",  1.0)),
            "__adam_step__":    np.array(model._step),
            "__is_fitted__":    np.array(int(model.is_fitted)),
            # Config
            "__seq_len__":      np.array(model.config.seq_len),
            "__lstm_hidden__":  np.array(model.config.lstm_hidden),
            "__mlp_hidden__":   np.array(model.config.mlp_hidden),
            "__mlp_hidden2__":  np.array(model.config.mlp_hidden2),
            "__fusion_hidden__":np.array(model.config.fusion_hidden),
            "__fusion_hidden2__":np.array(model.config.fusion_hidden2),
            "__dropout_rate__": np.array(model.config.dropout_rate),
        }

        np.savez_compressed(path, **params, **moments, **meta)
        logger.info("Saved PropNet[%s] → %s", stat_type, path)

    # -----------------------------------------------------------------------
    # Load
    # -----------------------------------------------------------------------

    def load(self, stat_type: str) -> Optional[PropNet]:
        """Load a PropNet from disk. Returns None if not found."""
        path = self._path(stat_type)
        if not path.exists():
            logger.debug("No saved model for %s at %s", stat_type, path)
            return None

        try:
            data = np.load(path, allow_pickle=False)
        except Exception as e:
            logger.error("Failed to load model for %s: %s", stat_type, e)
            return None

        # Reconstruct config
        cfg = PropNetConfig(
            seq_len=int(data["__seq_len__"]),
            lstm_hidden=int(data["__lstm_hidden__"]),
            mlp_hidden=int(data["__mlp_hidden__"]),
            mlp_hidden2=int(data["__mlp_hidden2__"]),
            fusion_hidden=int(data["__fusion_hidden__"]),
            fusion_hidden2=int(data["__fusion_hidden2__"]),
            dropout_rate=float(data["__dropout_rate__"]),
            stat_type=stat_type,
        )
        model = PropNet(cfg)

        # Restore weights and moments
        state = dict(data)
        model.load_all_params(state)
        model.load_all_moments(state)

        # Restore metadata
        model._y_mean  = float(data["__y_mean__"])
        model._y_std   = float(data["__y_std__"])
        model._step    = int(data["__adam_step__"])
        model.is_fitted = bool(int(data["__is_fitted__"]))

        # Re-apply denormalisation patch
        from .training import _patch_forward_denorm
        _patch_forward_denorm(model, model._y_mean, model._y_std)

        logger.info("Loaded PropNet[%s] from %s", stat_type, path)
        return model

    # -----------------------------------------------------------------------
    # Utilities
    # -----------------------------------------------------------------------

    def list_saved(self) -> list[str]:
        """Return stat types that have saved weights."""
        stat_types = []
        for p in sorted(self.base_dir.glob("propnet_*.npz")):
            slug = p.stem.replace("propnet_", "")
            stat_types.append(slug.replace("_", " "))
        return stat_types

    def delete(self, stat_type: str):
        """Remove saved weights for a stat type."""
        path = self._path(stat_type)
        if path.exists():
            os.remove(path)
            logger.info("Deleted PropNet[%s]", stat_type)
