"""
Bayesian Weight Optimizer

Runs weekly to update signal weights based on historical hit rates and CLV.

Formula:
    weight = (hit_rate * 0.6) + (clv_rate_normalized * 0.4)

Thompson Sampling dampening prevents overcorrection on small samples.
"""

import logging
import math
import os
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)

# Minimum samples required before adjusting weight meaningfully
MIN_SAMPLE_SIZE = 20
# Default/prior weight when not enough data
PRIOR_WEIGHT = 0.5
# Thompson Sampling pseudo-count (equivalent prior sample size)
THOMPSON_PRIOR = 10


def _get_db_connection():
    """Get a psycopg2 database connection."""
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


def _thompson_dampen(raw_rate: float, sample_size: int, prior: float = PRIOR_WEIGHT) -> float:
    """
    Apply Thompson Sampling dampening.

    Blends raw_rate toward a prior (0.5) based on sample_size.
    With THOMPSON_PRIOR=10, the prior carries weight equal to 10 observations.

    Args:
        raw_rate: Observed hit rate or CLV rate (0-1)
        sample_size: Number of observations
        prior: Prior belief (0.5 = uninformative)

    Returns:
        Dampened rate closer to prior when sample is small.
    """
    pseudo_observations = THOMPSON_PRIOR
    total = sample_size + pseudo_observations
    dampened = (raw_rate * sample_size + prior * pseudo_observations) / total
    return round(dampened, 4)


def _normalize_clv(clv_values: List[float]) -> float:
    """
    Normalize CLV to a 0-1 rate.

    Positive CLV (we beat the closing line) → rate > 0.5
    Negative CLV → rate < 0.5
    """
    if not clv_values:
        return 0.5
    avg_clv = sum(clv_values) / len(clv_values)
    # Map avg CLV to [0, 1] range; CLV of ±10 maps to [0, 1]
    normalized = max(0.0, min(1.0, (avg_clv + 10) / 20))
    return round(normalized, 4)


def compute_weight_for_signal(
    signal_type: str,
    outcomes: List[bool],
    clv_values: List[float],
) -> Dict[str, Any]:
    """
    Compute updated weight for a single signal type.

    Args:
        signal_type: Name of the signal
        outcomes: List of booleans (True = prediction hit)
        clv_values: List of closing line values (+ve = good)

    Returns:
        Dict with weight, hit_rate, clv_rate, sample_size
    """
    n = len(outcomes)
    if n == 0:
        return {
            "signal_type": signal_type,
            "weight": PRIOR_WEIGHT,
            "hit_rate": PRIOR_WEIGHT,
            "clv_rate": 0.5,
            "sample_size": 0,
        }

    # Raw hit rate
    raw_hit_rate = sum(outcomes) / n
    # Dampen toward 0.5 prior
    hit_rate = _thompson_dampen(raw_hit_rate, n, prior=0.5)

    # CLV rate normalized
    clv_rate_norm = _normalize_clv(clv_values)
    clv_rate_dampened = _thompson_dampen(clv_rate_norm, n, prior=0.5)

    # Combined weight
    weight = (hit_rate * 0.6) + (clv_rate_dampened * 0.4)
    weight = max(0.1, min(0.95, round(weight, 4)))

    return {
        "signal_type": signal_type,
        "weight": weight,
        "hit_rate": hit_rate,
        "clv_rate": clv_rate_dampened,
        "sample_size": n,
    }


def update_weights(db_conn=None, lookback_count: int = 200) -> Dict[str, Dict[str, Any]]:
    """
    Weekly job: re-compute and persist weights for all signal types.

    Args:
        db_conn: Optional existing psycopg2 connection (creates one if None)
        lookback_count: Number of most recent signal_results to use per signal type

    Returns:
        Dict[signal_type → updated weight info]
    """
    conn = db_conn or _get_db_connection()
    if conn is None:
        logger.error("Cannot update weights — no DB connection")
        return {}

    results: Dict[str, Dict[str, Any]] = {}
    own_conn = db_conn is None

    try:
        cursor = conn.cursor()

        # Get all distinct signal types with outcomes
        cursor.execute(
            "SELECT DISTINCT signal_type FROM signal_results WHERE outcome IS NOT NULL"
        )
        signal_types = [row[0] for row in cursor.fetchall()]
        logger.info(f"Updating weights for {len(signal_types)} signal types")

        for signal_type in signal_types:
            cursor.execute(
                """
                SELECT outcome, clv
                FROM signal_results
                WHERE signal_type = %s
                  AND outcome IS NOT NULL
                ORDER BY game_date DESC
                LIMIT %s
                """,
                (signal_type, lookback_count),
            )
            rows = cursor.fetchall()
            outcomes = [bool(row[0]) for row in rows]
            clv_values = [float(row[1]) for row in rows if row[1] is not None]

            stats = compute_weight_for_signal(signal_type, outcomes, clv_values)
            results[signal_type] = stats

            # Upsert into weight_registry
            cursor.execute(
                """
                INSERT INTO weight_registry (signal_type, weight, hit_rate, clv_rate, sample_size, updated_at)
                VALUES (%s, %s, %s, %s, %s, NOW())
                ON CONFLICT (signal_type) DO UPDATE SET
                    weight      = EXCLUDED.weight,
                    hit_rate    = EXCLUDED.hit_rate,
                    clv_rate    = EXCLUDED.clv_rate,
                    sample_size = EXCLUDED.sample_size,
                    updated_at  = NOW()
                """,
                (
                    signal_type,
                    stats["weight"],
                    stats["hit_rate"],
                    stats["clv_rate"],
                    stats["sample_size"],
                ),
            )

            logger.info(
                f"  {signal_type}: weight={stats['weight']:.4f} "
                f"hit_rate={stats['hit_rate']:.4f} "
                f"clv_rate={stats['clv_rate']:.4f} "
                f"n={stats['sample_size']}"
            )

        conn.commit()
        cursor.close()
        logger.info("Weight update complete")

    except Exception as e:
        logger.error(f"update_weights failed: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
    finally:
        if own_conn:
            conn.close()

    return results


def get_current_weights(db_conn=None) -> Dict[str, float]:
    """
    Fetch current weights from weight_registry.

    Returns:
        Dict[signal_type → weight]
    """
    conn = db_conn or _get_db_connection()
    if conn is None:
        return {}
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT signal_type, weight FROM weight_registry")
        rows = cursor.fetchall()
        cursor.close()
        if db_conn is None:
            conn.close()
        return {row[0]: float(row[1]) for row in rows if row[1] is not None}
    except Exception as e:
        logger.error(f"get_current_weights failed: {e}")
        return {}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    weights = update_weights()
    import json
    print(json.dumps(weights, indent=2))
