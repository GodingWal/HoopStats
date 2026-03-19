"""
Correlation Engine

Calculates pairwise player stat correlations from shared game logs.
Results are cached in the player_correlations table (upsert on conflict)
and refreshed weekly via refresh_all_correlations().

Cron target: Sunday nights via `python scripts/cron_jobs.py correlations`
"""

import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
from scipy.stats import pearsonr

logger = logging.getLogger(__name__)

# ── Stat column mapping (PrizePicks labels → player_game_stats columns) ────────
STAT_COL_MAP: Dict[str, str] = {
    "pts": "pts",
    "reb": "reb",
    "ast": "ast",
    "3pm": "fg3m",
    "stl": "stl",
    "blk": "blk",
    "tov": "tov",
    "pra": None,  # combo — handled specially
}

COMBO_STATS: Dict[str, List[str]] = {
    "pra": ["pts", "reb", "ast"],
    "pr": ["pts", "reb"],
    "pa": ["pts", "ast"],
    "ra": ["reb", "ast"],
}

MIN_SHARED_GAMES = 20


# ── DB helper ─────────────────────────────────────────────────────────────────

def _get_db_connection():
    try:
        import psycopg2
        db_url = os.environ.get("DATABASE_URL")
        if db_url:
            return psycopg2.connect(db_url)
        return psycopg2.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            port=int(os.environ.get("DB_PORT", 5432)),
            database=os.environ.get("DB_NAME", "courtsideedge"),
            user=os.environ.get("DB_USER", "postgres"),
            password=os.environ.get("DB_PASSWORD", ""),
        )
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None


# ── Classification helpers ────────────────────────────────────────────────────

def _classify_relationship(correlation: float) -> str:
    if correlation > 0.35:
        return "STRONG_POSITIVE"
    if correlation > 0.15:
        return "WEAK_POSITIVE"
    if correlation < -0.35:
        return "STRONG_NEGATIVE"
    if correlation < -0.15:
        return "WEAK_NEGATIVE"
    return "NEUTRAL"


def _classify_confidence(p_value: float, sample_size: int) -> str:
    if p_value < 0.05 and sample_size >= 40:
        return "HIGH"
    if p_value < 0.10 and sample_size >= 25:
        return "MEDIUM"
    return "LOW"


# ── Main class ────────────────────────────────────────────────────────────────

class CorrelationEngine:
    """
    Computes and caches pairwise player stat correlations.

    All results are persisted in player_correlations (upsert).
    Use get_correlation() for fast cached lookups during daily scoring.
    Use refresh_all_correlations() for the weekly Sunday-night batch.
    """

    def __init__(self, conn=None):
        self._conn = conn
        self._owns_conn = conn is None

    # ── Connection management ──────────────────────────────────────────────

    def _get_conn(self):
        if self._conn is not None:
            return self._conn
        return _get_db_connection()

    def _release_conn(self, conn):
        if self._owns_conn and conn is not None:
            try:
                conn.close()
            except Exception:
                pass

    # ── Public API ─────────────────────────────────────────────────────────

    def calculate_player_correlation(
        self,
        player_a_id: str,
        player_b_id: str,
        stat: str,
        lookback_days: int = 60,
    ) -> Dict[str, Any]:
        """
        Calculate Pearson correlation between two players for a given stat
        using their shared game logs over the last `lookback_days` days.

        Returns a result dict with keys:
            correlation, p_value, sample_size, confidence,
            relationship, same_team, player_a_id, player_b_id, stat_type
        """
        insufficient = {
            "player_a_id": player_a_id,
            "player_b_id": player_b_id,
            "stat_type": stat,
            "correlation": None,
            "p_value": None,
            "sample_size": 0,
            "confidence": "INSUFFICIENT",
            "relationship": "NEUTRAL",
            "same_team": False,
        }

        conn = self._get_conn()
        if conn is None:
            logger.error("No DB connection for correlation calculation")
            return insufficient

        try:
            cursor = conn.cursor()

            # Resolve stat column(s)
            stat_cols = self._resolve_stat_cols(stat)
            if not stat_cols:
                logger.warning(f"Unknown stat type: {stat}")
                self._release_conn(conn)
                return insufficient

            cutoff = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y-%m-%d")

            # Pull shared games for both players (inner join on game_id)
            col_select_a = self._build_stat_select("a", stat_cols)
            col_select_b = self._build_stat_select("b", stat_cols)

            cursor.execute(
                f"""
                SELECT
                    {col_select_a} AS stat_a,
                    {col_select_b} AS stat_b,
                    a.team_id AS team_a,
                    b.team_id AS team_b
                FROM player_game_stats a
                INNER JOIN player_game_stats b
                    ON a.game_id = b.game_id
                WHERE a.player_id = %s
                  AND b.player_id = %s
                  AND a.game_date >= %s
                  AND a.minutes_played > 0
                  AND b.minutes_played > 0
                ORDER BY a.game_date
                """,
                (player_a_id, player_b_id, cutoff),
            )
            rows = cursor.fetchall()
            cursor.close()

            if len(rows) < MIN_SHARED_GAMES:
                result = {**insufficient, "sample_size": len(rows)}
                self._upsert_correlation(result, conn)
                self._release_conn(conn)
                return result

            stats_a = np.array([float(r[0]) for r in rows], dtype=float)
            stats_b = np.array([float(r[1]) for r in rows], dtype=float)

            # Check variance — pearsonr undefined for constant series
            if stats_a.std() < 1e-9 or stats_b.std() < 1e-9:
                result = {**insufficient, "sample_size": len(rows)}
                self._upsert_correlation(result, conn)
                self._release_conn(conn)
                return result

            corr, pval = pearsonr(stats_a, stats_b)
            corr = float(np.clip(corr, -1.0, 1.0))
            pval = float(pval)
            sample_size = len(rows)

            # Detect same-team relationship from the most recent shared game
            team_a = rows[-1][2]
            team_b = rows[-1][3]
            same_team = (team_a is not None and team_a == team_b)

            result = {
                "player_a_id": player_a_id,
                "player_b_id": player_b_id,
                "stat_type": stat,
                "correlation": round(corr, 3),
                "p_value": round(pval, 4),
                "sample_size": sample_size,
                "confidence": _classify_confidence(pval, sample_size),
                "relationship": _classify_relationship(corr),
                "same_team": same_team,
            }

            self._upsert_correlation(result, conn)
            self._release_conn(conn)
            return result

        except Exception as e:
            logger.error(
                f"Error calculating correlation {player_a_id}/{player_b_id}/{stat}: {e}"
            )
            self._release_conn(conn)
            return insufficient

    def build_team_correlation_matrix(
        self, team_id: str, stat: str = "pts"
    ) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
        """
        Build a full pairwise correlation matrix for all rotation players
        on a given team (15+ min/game in last 60 days).

        Returns:
            (matrix_df, summary_list)
            matrix_df  — DataFrame with player_ids as index and columns
            summary_list — list of correlation dicts sorted by |correlation| DESC
        """
        conn = self._get_conn()
        if conn is None:
            return pd.DataFrame(), []

        try:
            cursor = conn.cursor()
            cutoff = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")

            cursor.execute(
                """
                SELECT DISTINCT player_id
                FROM player_game_stats
                WHERE team_id = %s
                  AND game_date >= %s
                  AND minutes_played >= 15
                GROUP BY player_id
                HAVING COUNT(*) >= 10
                """,
                (team_id, cutoff),
            )
            player_ids = [str(r[0]) for r in cursor.fetchall()]
            cursor.close()
            self._release_conn(conn)

            if len(player_ids) < 2:
                logger.info(f"Team {team_id}: fewer than 2 rotation players found")
                return pd.DataFrame(), []

            # Build matrix
            matrix = pd.DataFrame(index=player_ids, columns=player_ids, dtype=float)
            np.fill_diagonal(matrix.values, 1.0)

            summary: List[Dict[str, Any]] = []

            for i, pid_a in enumerate(player_ids):
                for pid_b in player_ids[i + 1:]:
                    res = self.calculate_player_correlation(pid_a, pid_b, stat)
                    corr = res.get("correlation")
                    if corr is not None:
                        matrix.at[pid_a, pid_b] = corr
                        matrix.at[pid_b, pid_a] = corr
                        summary.append(res)

            summary.sort(key=lambda x: abs(x.get("correlation") or 0.0), reverse=True)
            return matrix, summary

        except Exception as e:
            logger.error(f"Error building team matrix for {team_id}/{stat}: {e}")
            self._release_conn(conn)
            return pd.DataFrame(), []

    def refresh_all_correlations(self) -> int:
        """
        Weekly batch job. For every active player pair (both played 10+ games
        this season), recalculate and upsert into player_correlations.

        Logs progress every 100 pairs. Sleeps 0.5s between NBA API calls
        to avoid rate limiting.

        Returns number of pairs processed.
        """
        conn = self._get_conn()
        if conn is None:
            logger.error("No DB connection for refresh_all_correlations")
            return 0

        try:
            cursor = conn.cursor()
            cutoff = (datetime.now() - timedelta(days=180)).strftime("%Y-%m-%d")

            # Fetch all active players (10+ games this season)
            cursor.execute(
                """
                SELECT DISTINCT player_id, team_id
                FROM player_game_stats
                WHERE game_date >= %s
                GROUP BY player_id, team_id
                HAVING COUNT(*) >= 10
                """,
                (cutoff,),
            )
            players = cursor.fetchall()
            cursor.close()
            self._release_conn(conn)

        except Exception as e:
            logger.error(f"Failed to fetch active players: {e}")
            self._release_conn(conn)
            return 0

        if len(players) < 2:
            logger.warning("Fewer than 2 active players found for correlation refresh")
            return 0

        stats_to_run = ["pts", "reb", "ast", "3pm", "pra"]
        total_pairs = 0
        processed = 0

        # Deduplicate player list (take most recent team)
        player_map: Dict[str, str] = {}
        for pid, tid in players:
            player_map[str(pid)] = str(tid) if tid else ""
        player_ids = list(player_map.keys())

        # Generate all unique pairs
        pairs: List[Tuple[str, str]] = []
        for i in range(len(player_ids)):
            for j in range(i + 1, len(player_ids)):
                pairs.append((player_ids[i], player_ids[j]))

        total_pairs = len(pairs) * len(stats_to_run)
        logger.info(
            f"refresh_all_correlations: {len(pairs)} pairs × {len(stats_to_run)} stats "
            f"= {total_pairs} calculations"
        )

        for idx, (pid_a, pid_b) in enumerate(pairs):
            for stat in stats_to_run:
                self.calculate_player_correlation(pid_a, pid_b, stat)
                time.sleep(0.5)
                processed += 1

            if (idx + 1) % 100 == 0:
                logger.info(
                    f"  Progress: {idx + 1}/{len(pairs)} pairs "
                    f"({processed}/{total_pairs} calcs)"
                )

        logger.info(f"refresh_all_correlations complete: {processed} calculations")
        return processed

    def get_correlation(
        self, player_a_id: str, player_b_id: str, stat: str
    ) -> float:
        """
        Fast lookup from DB cache.  If not found or stale (>7 days), triggers
        calculate_player_correlation() inline.

        Returns Pearson r float, or 0.0 if insufficient data.
        """
        conn = self._get_conn()
        if conn is None:
            return 0.0

        try:
            cursor = conn.cursor()
            stale_cutoff = (datetime.now() - timedelta(days=7)).strftime(
                "%Y-%m-%d %H:%M:%S"
            )

            # Try both orderings (a,b) and (b,a) — we store canonical order
            cursor.execute(
                """
                SELECT correlation, confidence, updated_at
                FROM player_correlations
                WHERE (
                    (player_a_id = %s AND player_b_id = %s)
                    OR
                    (player_a_id = %s AND player_b_id = %s)
                )
                AND stat_type = %s
                LIMIT 1
                """,
                (player_a_id, player_b_id, player_b_id, player_a_id, stat),
            )
            row = cursor.fetchone()
            cursor.close()
            self._release_conn(conn)

            if row:
                corr, confidence, updated_at = row
                # Check staleness
                if updated_at and updated_at >= datetime.strptime(stale_cutoff, "%Y-%m-%d %H:%M:%S"):
                    if confidence == "INSUFFICIENT" or corr is None:
                        return 0.0
                    return float(corr)

            # Not found or stale — recalculate inline
            result = self.calculate_player_correlation(player_a_id, player_b_id, stat)
            corr = result.get("correlation")
            return float(corr) if corr is not None else 0.0

        except Exception as e:
            logger.warning(
                f"get_correlation error {player_a_id}/{player_b_id}/{stat}: {e}"
            )
            self._release_conn(conn)
            # Fall back to inline calculation
            try:
                result = self.calculate_player_correlation(player_a_id, player_b_id, stat)
                corr = result.get("correlation")
                return float(corr) if corr is not None else 0.0
            except Exception:
                return 0.0

    # ── Private helpers ────────────────────────────────────────────────────

    def _resolve_stat_cols(self, stat: str) -> List[str]:
        """Return list of DB columns for a stat type."""
        stat = stat.lower()
        if stat in COMBO_STATS:
            return COMBO_STATS[stat]
        col = STAT_COL_MAP.get(stat)
        if col:
            return [col]
        return []

    def _build_stat_select(self, alias: str, cols: List[str]) -> str:
        """Build SQL expression to sum multiple stat columns."""
        if len(cols) == 1:
            return f"{alias}.{cols[0]}"
        return " + ".join(f"COALESCE({alias}.{c}, 0)" for c in cols)

    def _upsert_correlation(self, result: Dict[str, Any], conn) -> None:
        """Upsert a correlation result into player_correlations."""
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO player_correlations
                    (player_a_id, player_b_id, stat_type, correlation, p_value,
                     sample_size, confidence, relationship, same_team, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (player_a_id, player_b_id, stat_type)
                DO UPDATE SET
                    correlation  = EXCLUDED.correlation,
                    p_value      = EXCLUDED.p_value,
                    sample_size  = EXCLUDED.sample_size,
                    confidence   = EXCLUDED.confidence,
                    relationship = EXCLUDED.relationship,
                    same_team    = EXCLUDED.same_team,
                    updated_at   = NOW()
                """,
                (
                    result["player_a_id"],
                    result["player_b_id"],
                    result["stat_type"],
                    result.get("correlation"),
                    result.get("p_value"),
                    result.get("sample_size", 0),
                    result.get("confidence", "INSUFFICIENT"),
                    result.get("relationship", "NEUTRAL"),
                    result.get("same_team", False),
                ),
            )
            conn.commit()
            cursor.close()
        except Exception as e:
            logger.warning(f"Upsert failed for correlation result: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
