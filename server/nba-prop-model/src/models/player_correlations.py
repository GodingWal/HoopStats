"""
Player-Specific Correlation Matrices

Replaces the static default correlation matrix with player-specific
(or archetype-specific) correlations estimated from game logs.

A pass-first PG has very different PTS/AST correlation than a scoring wing.
"""

from typing import Dict, Optional, Tuple
import numpy as np
import pandas as pd
from dataclasses import dataclass


@dataclass
class PlayerArchetype:
    """Player archetype for correlation grouping."""
    name: str
    description: str
    correlation_matrix: np.ndarray


class PlayerCorrelationEstimator:
    """
    Estimates player-specific correlation matrices from game logs.

    Falls back to archetype-based correlations when sample size is small,
    and to league-wide defaults when archetype is unknown.
    """

    # Minimum games to estimate player-specific correlations
    MIN_GAMES_PLAYER = 20

    # Minimum games to use partial player data (blend with archetype)
    MIN_GAMES_BLEND = 10

    STAT_COLS = ['PTS', 'REB', 'AST', 'FG3M', 'STL', 'BLK', 'TOV']

    # Archetype correlation matrices (estimated from historical data)
    # These capture typical correlation structures for different player types

    # Scoring guard: High PTS-3PM correlation, moderate PTS-AST
    SCORING_GUARD_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.10, 0.25, 0.55, 0.12, 0.02, 0.35],  # Points
        [0.10, 1.00, 0.08, 0.03, 0.12, 0.25, 0.03],  # Rebounds
        [0.25, 0.08, 1.00, 0.15, 0.18, 0.03, 0.30],  # Assists
        [0.55, 0.03, 0.15, 1.00, 0.05, 0.00, 0.12],  # 3PM
        [0.12, 0.12, 0.18, 0.05, 1.00, 0.10, 0.08],  # Steals
        [0.02, 0.25, 0.03, 0.00, 0.10, 1.00, 0.02],  # Blocks
        [0.35, 0.03, 0.30, 0.12, 0.08, 0.02, 1.00],  # Turnovers
    ])

    # Pass-first guard: High AST-TOV correlation, high PTS-AST
    PASS_FIRST_GUARD_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.12, 0.45, 0.40, 0.15, 0.03, 0.28],  # Points
        [0.12, 1.00, 0.12, 0.05, 0.15, 0.22, 0.05],  # Rebounds
        [0.45, 0.12, 1.00, 0.18, 0.22, 0.05, 0.45],  # Assists
        [0.40, 0.05, 0.18, 1.00, 0.08, 0.00, 0.10],  # 3PM
        [0.15, 0.15, 0.22, 0.08, 1.00, 0.12, 0.12],  # Steals
        [0.03, 0.22, 0.05, 0.00, 0.12, 1.00, 0.03],  # Blocks
        [0.28, 0.05, 0.45, 0.10, 0.12, 0.03, 1.00],  # Turnovers
    ])

    # Wing scorer: Balanced PTS-REB-AST, moderate 3PM correlation
    WING_SCORER_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.18, 0.30, 0.42, 0.10, 0.05, 0.32],  # Points
        [0.18, 1.00, 0.12, 0.05, 0.15, 0.28, 0.05],  # Rebounds
        [0.30, 0.12, 1.00, 0.15, 0.18, 0.05, 0.28],  # Assists
        [0.42, 0.05, 0.15, 1.00, 0.05, 0.00, 0.10],  # 3PM
        [0.10, 0.15, 0.18, 0.05, 1.00, 0.12, 0.10],  # Steals
        [0.05, 0.28, 0.05, 0.00, 0.12, 1.00, 0.05],  # Blocks
        [0.32, 0.05, 0.28, 0.10, 0.10, 0.05, 1.00],  # Turnovers
    ])

    # Big man (post-centric): High REB-BLK, low PTS-3PM
    BIG_POST_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.25, 0.20, 0.10, 0.08, 0.10, 0.25],  # Points
        [0.25, 1.00, 0.10, 0.00, 0.15, 0.35, 0.05],  # Rebounds
        [0.20, 0.10, 1.00, 0.05, 0.15, 0.08, 0.30],  # Assists
        [0.10, 0.00, 0.05, 1.00, 0.03, 0.00, 0.05],  # 3PM
        [0.08, 0.15, 0.15, 0.03, 1.00, 0.18, 0.08],  # Steals
        [0.10, 0.35, 0.08, 0.00, 0.18, 1.00, 0.05],  # Blocks
        [0.25, 0.05, 0.30, 0.05, 0.08, 0.05, 1.00],  # Turnovers
    ])

    # Stretch big: Like big man but with PTS-3PM correlation
    STRETCH_BIG_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.20, 0.15, 0.45, 0.08, 0.08, 0.22],  # Points
        [0.20, 1.00, 0.08, 0.03, 0.15, 0.32, 0.05],  # Rebounds
        [0.15, 0.08, 1.00, 0.10, 0.12, 0.05, 0.25],  # Assists
        [0.45, 0.03, 0.10, 1.00, 0.05, 0.00, 0.08],  # 3PM
        [0.08, 0.15, 0.12, 0.05, 1.00, 0.15, 0.08],  # Steals
        [0.08, 0.32, 0.05, 0.00, 0.15, 1.00, 0.05],  # Blocks
        [0.22, 0.05, 0.25, 0.08, 0.08, 0.05, 1.00],  # Turnovers
    ])

    # Point-forward (playmaking big): High AST for size, balanced
    POINT_FORWARD_CORR = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.20, 0.38, 0.30, 0.12, 0.08, 0.30],  # Points
        [0.20, 1.00, 0.15, 0.05, 0.15, 0.30, 0.08],  # Rebounds
        [0.38, 0.15, 1.00, 0.15, 0.20, 0.08, 0.40],  # Assists
        [0.30, 0.05, 0.15, 1.00, 0.05, 0.00, 0.10],  # 3PM
        [0.12, 0.15, 0.20, 0.05, 1.00, 0.15, 0.10],  # Steals
        [0.08, 0.30, 0.08, 0.00, 0.15, 1.00, 0.05],  # Blocks
        [0.30, 0.08, 0.40, 0.10, 0.10, 0.05, 1.00],  # Turnovers
    ])

    ARCHETYPE_MAP = {
        'scoring_guard': SCORING_GUARD_CORR,
        'pass_first_guard': PASS_FIRST_GUARD_CORR,
        'wing_scorer': WING_SCORER_CORR,
        'big_post': BIG_POST_CORR,
        'stretch_big': STRETCH_BIG_CORR,
        'point_forward': POINT_FORWARD_CORR,
    }

    # League-wide default (from DistributionModeler)
    DEFAULT_CORRELATIONS = np.array([
        [1.00, 0.15, 0.35, 0.45, 0.10, 0.05, 0.30],
        [0.15, 1.00, 0.10, 0.05, 0.15, 0.30, 0.05],
        [0.35, 0.10, 1.00, 0.20, 0.20, 0.05, 0.25],
        [0.45, 0.05, 0.20, 1.00, 0.05, 0.00, 0.10],
        [0.10, 0.15, 0.20, 0.05, 1.00, 0.15, 0.10],
        [0.05, 0.30, 0.05, 0.00, 0.15, 1.00, 0.05],
        [0.30, 0.05, 0.25, 0.10, 0.10, 0.05, 1.00],
    ])

    def get_correlation_matrix(
        self,
        game_log: pd.DataFrame,
        position: str = 'G',
        ast_per_min: float = 0.0,
        reb_per_min: float = 0.0,
        three_par: float = 0.0,
    ) -> np.ndarray:
        """
        Get the best available correlation matrix for a player.

        Priority:
        1. Player-specific from game logs (if 20+ games)
        2. Blended player + archetype (if 10-19 games)
        3. Archetype-based (if position/style known)
        4. League-wide default

        Args:
            game_log: Player's game log DataFrame
            position: Player position ('G', 'F', 'C')
            ast_per_min: Assists per minute (for archetype detection)
            reb_per_min: Rebounds per minute
            three_par: 3-point attempt rate

        Returns:
            7x7 correlation matrix
        """
        n_games = len(game_log) if game_log is not None else 0

        # Try player-specific
        if n_games >= self.MIN_GAMES_PLAYER:
            player_corr = self._estimate_from_game_log(game_log)
            if player_corr is not None:
                return player_corr

        # Determine archetype
        archetype = self._classify_archetype(position, ast_per_min, reb_per_min, three_par)
        archetype_corr = self.ARCHETYPE_MAP.get(archetype, self.DEFAULT_CORRELATIONS)

        # Blend player data with archetype if we have partial data
        if n_games >= self.MIN_GAMES_BLEND:
            player_corr = self._estimate_from_game_log(game_log)
            if player_corr is not None:
                blend_weight = (n_games - self.MIN_GAMES_BLEND) / (self.MIN_GAMES_PLAYER - self.MIN_GAMES_BLEND)
                blend_weight = min(max(blend_weight, 0.0), 1.0)
                blended = blend_weight * player_corr + (1 - blend_weight) * archetype_corr
                return self._ensure_valid_correlation(blended)

        return archetype_corr

    def _estimate_from_game_log(self, game_log: pd.DataFrame) -> Optional[np.ndarray]:
        """Estimate correlation matrix from player's game log."""
        available_cols = [c for c in self.STAT_COLS if c in game_log.columns]

        if len(available_cols) < 4:
            return None

        # Calculate correlation
        try:
            corr_df = game_log[available_cols].corr()

            # Build full 7x7 matrix, filling missing with defaults
            full_corr = self.DEFAULT_CORRELATIONS.copy()
            for i, col_i in enumerate(self.STAT_COLS):
                for j, col_j in enumerate(self.STAT_COLS):
                    if col_i in corr_df.columns and col_j in corr_df.columns:
                        val = corr_df.loc[col_i, col_j]
                        if not np.isnan(val):
                            full_corr[i, j] = val

            return self._ensure_valid_correlation(full_corr)
        except Exception:
            return None

    def _classify_archetype(
        self,
        position: str,
        ast_per_min: float,
        reb_per_min: float,
        three_par: float,
    ) -> str:
        """Classify player into an archetype for correlation lookup."""

        position = position.upper() if position else 'G'

        if position in ('G', 'PG', 'SG', 'GUARD'):
            if ast_per_min > 0.25:
                return 'pass_first_guard'
            else:
                return 'scoring_guard'

        elif position in ('F', 'SF', 'PF', 'FORWARD'):
            if ast_per_min > 0.20:
                return 'point_forward'
            else:
                return 'wing_scorer'

        elif position in ('C', 'CENTER'):
            if three_par > 0.25:
                return 'stretch_big'
            else:
                return 'big_post'

        # Default
        if ast_per_min > 0.25:
            return 'pass_first_guard'
        elif reb_per_min > 0.30:
            return 'big_post'
        else:
            return 'wing_scorer'

    def _ensure_valid_correlation(self, matrix: np.ndarray) -> np.ndarray:
        """Ensure correlation matrix is valid (symmetric, PSD, diag=1)."""
        # Make symmetric
        matrix = (matrix + matrix.T) / 2

        # Set diagonal to 1
        np.fill_diagonal(matrix, 1.0)

        # Clip to [-1, 1]
        matrix = np.clip(matrix, -1.0, 1.0)

        # Ensure positive semi-definite
        eigvals = np.linalg.eigvalsh(matrix)
        if np.min(eigvals) < 0:
            # Nearest correlation matrix via spectral decomposition
            eigenvalues, eigenvectors = np.linalg.eigh(matrix)
            eigenvalues = np.maximum(eigenvalues, 1e-6)
            matrix = eigenvectors @ np.diag(eigenvalues) @ eigenvectors.T
            # Re-normalize
            d = np.sqrt(np.diag(matrix))
            matrix = matrix / np.outer(d, d)
            np.fill_diagonal(matrix, 1.0)

        return matrix
