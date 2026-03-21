"""
Outcome Logger — logs every bet with all raw features + outcome.

This is the foundation for XGBoost training. Without labeled data,
no model can be trained. Every bet must be logged with:
  1. Full feature vector at prediction time
  2. Actual outcome (post-game)
  3. Line value and hit/miss

Schema writes to `xgboost_training_log` table (see migration 011).

Usage:
    logger = OutcomeLogger(db_conn)

    # At prediction time — log features
    logger.log_prediction(
        player_id="jalen_brunson_1",
        game_date="2025-12-15",
        stat_type="Points",
        line=24.5,
        features=feature_vector.features,
        signal_score=0.42,
        edge_total=18,
        predicted_direction="OVER",
    )

    # Post-game — fill in actual result
    logger.log_outcome(
        player_id="jalen_brunson_1",
        game_date="2025-12-15",
        stat_type="Points",
        actual_value=28.0,
    )
"""

import json
import logging
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class OutcomeLogger:
    """
    Logs predictions and outcomes for XGBoost training data collection.

    Writes to `xgboost_training_log` table. Predictions are logged pre-game,
    outcomes are filled in post-game via UPDATE.
    """

    TABLE_NAME = "xgboost_training_log"

    def __init__(self, db_conn=None):
        self.db_conn = db_conn

    def log_prediction(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        line: float,
        features: Dict[str, float],
        signal_score: float = 0.0,
        edge_total: float = 0.0,
        predicted_direction: str = "OVER",
        confidence_tier: str = "LEAN",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """
        Log a prediction with its full feature vector.

        Args:
            player_id: Player identifier.
            game_date: Game date (YYYY-MM-DD).
            stat_type: Stat type (e.g. "Points").
            line: Betting line value.
            features: Full XGBoost feature dict from XGBoostFeatureBuilder.
            signal_score: Combined signal score (0-1).
            edge_total: Total edge score from edge detection.
            predicted_direction: "OVER" or "UNDER".
            confidence_tier: Confidence tier from signal engine.
            metadata: Optional extra metadata.

        Returns:
            True if logged successfully, False otherwise.
        """
        if self.db_conn is None:
            logger.debug("No DB connection — prediction not logged")
            return False

        try:
            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                INSERT INTO {self.TABLE_NAME} (
                    player_id, game_date, stat_type, line_value,
                    features, signal_score, edge_total,
                    predicted_direction, confidence_tier, metadata,
                    captured_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (player_id, game_date, stat_type)
                DO UPDATE SET
                    line_value = EXCLUDED.line_value,
                    features = EXCLUDED.features,
                    signal_score = EXCLUDED.signal_score,
                    edge_total = EXCLUDED.edge_total,
                    predicted_direction = EXCLUDED.predicted_direction,
                    confidence_tier = EXCLUDED.confidence_tier,
                    metadata = EXCLUDED.metadata,
                    captured_at = EXCLUDED.captured_at
                """,
                (
                    player_id,
                    game_date,
                    stat_type,
                    line,
                    json.dumps(features),
                    signal_score,
                    edge_total,
                    predicted_direction,
                    confidence_tier,
                    json.dumps(metadata or {}),
                    datetime.utcnow(),
                ),
            )
            self.db_conn.commit()
            cursor.close()
            logger.debug(f"Logged prediction: {player_id} {stat_type} {game_date}")
            return True
        except Exception as e:
            logger.warning(f"Failed to log prediction: {e}")
            return False

    def log_outcome(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        actual_value: float,
        actual_minutes: Optional[float] = None,
        closing_line: Optional[float] = None,
    ) -> bool:
        """
        Fill in post-game outcome for a previously logged prediction.

        Args:
            player_id: Player identifier.
            game_date: Game date (YYYY-MM-DD).
            stat_type: Stat type.
            actual_value: Actual stat value achieved.
            actual_minutes: Actual minutes played.
            closing_line: Closing line value (for CLV calculation).

        Returns:
            True if updated successfully.
        """
        if self.db_conn is None:
            logger.debug("No DB connection — outcome not logged")
            return False

        try:
            cursor = self.db_conn.cursor()

            # First get the line_value so we can compute hit
            cursor.execute(
                f"""
                SELECT line_value FROM {self.TABLE_NAME}
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
                """,
                (player_id, game_date, stat_type),
            )
            row = cursor.fetchone()
            if row is None:
                logger.warning(
                    f"No prediction found to update: {player_id} {stat_type} {game_date}"
                )
                cursor.close()
                return False

            line_value = float(row[0])
            hit = actual_value > line_value
            clv = None
            if closing_line is not None:
                clv = line_value - closing_line  # positive = we got a better line

            cursor.execute(
                f"""
                UPDATE {self.TABLE_NAME}
                SET actual_value = %s,
                    actual_minutes = %s,
                    hit = %s,
                    closing_line = %s,
                    closing_line_value = %s,
                    settled_at = %s
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
                """,
                (
                    actual_value,
                    actual_minutes,
                    hit,
                    closing_line,
                    clv,
                    datetime.utcnow(),
                    player_id,
                    game_date,
                    stat_type,
                ),
            )
            self.db_conn.commit()
            cursor.close()
            logger.debug(
                f"Logged outcome: {player_id} {stat_type} {game_date} "
                f"actual={actual_value} hit={hit}"
            )
            return True
        except Exception as e:
            logger.warning(f"Failed to log outcome: {e}")
            return False

    def get_training_data(
        self,
        stat_type: Optional[str] = None,
        min_date: Optional[str] = None,
        max_date: Optional[str] = None,
        limit: int = 5000,
    ) -> list:
        """
        Retrieve labeled training data (predictions with outcomes).

        Args:
            stat_type: Filter by stat type (None = all).
            min_date: Minimum game date (YYYY-MM-DD).
            max_date: Maximum game date (YYYY-MM-DD).
            limit: Maximum rows to return.

        Returns:
            List of dicts with features and target.
        """
        if self.db_conn is None:
            return []

        try:
            conditions = ["actual_value IS NOT NULL"]
            params = []

            if stat_type:
                conditions.append("stat_type = %s")
                params.append(stat_type)
            if min_date:
                conditions.append("game_date >= %s")
                params.append(min_date)
            if max_date:
                conditions.append("game_date <= %s")
                params.append(max_date)

            where_clause = " AND ".join(conditions)
            params.append(limit)

            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                SELECT features, actual_value, line_value, hit,
                       player_id, game_date, stat_type
                FROM {self.TABLE_NAME}
                WHERE {where_clause}
                ORDER BY game_date DESC
                LIMIT %s
                """,
                params,
            )
            rows = cursor.fetchall()
            cursor.close()

            results = []
            for row in rows:
                features = json.loads(row[0]) if isinstance(row[0], str) else row[0]
                results.append({
                    "features": features,
                    "actual_value": float(row[1]),
                    "line_value": float(row[2]),
                    "hit": bool(row[3]),
                    "target": int(row[3]),
                    "player_id": row[4],
                    "game_date": str(row[5]),
                    "stat_type": row[6],
                })

            logger.info(f"Retrieved {len(results)} training rows")
            return results
        except Exception as e:
            logger.warning(f"Failed to retrieve training data: {e}")
            return []

    def get_training_stats(self) -> Dict[str, Any]:
        """Get summary statistics about available training data."""
        if self.db_conn is None:
            return {"total": 0, "labeled": 0, "unlabeled": 0}

        try:
            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                SELECT
                    COUNT(*) as total,
                    COUNT(actual_value) as labeled,
                    COUNT(*) - COUNT(actual_value) as unlabeled,
                    COUNT(DISTINCT stat_type) as stat_types,
                    MIN(game_date) as earliest,
                    MAX(game_date) as latest
                FROM {self.TABLE_NAME}
                """
            )
            row = cursor.fetchone()
            cursor.close()

            return {
                "total": row[0],
                "labeled": row[1],
                "unlabeled": row[2],
                "stat_types": row[3],
                "earliest_date": str(row[4]) if row[4] else None,
                "latest_date": str(row[5]) if row[5] else None,
            }
        except Exception as e:
            logger.warning(f"Failed to get training stats: {e}")
            return {"total": 0, "labeled": 0, "unlabeled": 0}
