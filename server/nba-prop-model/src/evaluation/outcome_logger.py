"""
Outcome Logger - logs every bet with all raw features + outcome + SHAP.

This is the foundation for XGBoost training. Every bet is logged with:
  1. Full feature vector at prediction time
  2. SHAP explanation (top drivers for this prediction)
  3. Actual outcome (post-game)
  4. Line value and hit/miss

Schema writes to `xgboost_training_log` table (see migration 011).
"""


import json
import logging
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime

logger = logging.getLogger(__name__)


class OutcomeLogger:
    """
    Logs predictions and outcomes for XGBoost training data collection.
    Now includes SHAP explanation data for model interpretability.
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
        model_prob: Optional[float] = None,
        calibration_method: Optional[str] = None,
        shap_top_drivers: Optional[List[Dict[str, Any]]] = None,
        shap_base_value: Optional[float] = None,
    ) -> bool:
        """
        Log a prediction with its full feature vector and SHAP explanations.

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
            model_prob: XGBoost model probability (0-1).
            calibration_method: Calibration method used (e.g. "isotonic").
            shap_top_drivers: List of SHAP driver dicts with feature, shap_value, etc.
            shap_base_value: SHAP base value (expected value of model output).

        Returns:
            True if logged successfully, False otherwise.
        """
        if self.db_conn is None:
            logger.debug("No DB connection - prediction not logged")
            return False

        try:
            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                INSERT INTO {self.TABLE_NAME} (
                    player_id, game_date, stat_type, line_value,
                    features, signal_score, edge_total,
                    predicted_direction, confidence_tier, metadata,
                    model_prob, calibration_method,
                    shap_top_drivers, shap_base_value,
                    captured_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (player_id, game_date, stat_type)
                DO UPDATE SET
                    line_value = EXCLUDED.line_value,
                    features = EXCLUDED.features,
                    signal_score = EXCLUDED.signal_score,
                    edge_total = EXCLUDED.edge_total,
                    predicted_direction = EXCLUDED.predicted_direction,
                    confidence_tier = EXCLUDED.confidence_tier,
                    metadata = EXCLUDED.metadata,
                    model_prob = EXCLUDED.model_prob,
                    calibration_method = EXCLUDED.calibration_method,
                    shap_top_drivers = EXCLUDED.shap_top_drivers,
                    shap_base_value = EXCLUDED.shap_base_value,
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
                    model_prob,
                    calibration_method,
                    json.dumps(shap_top_drivers) if shap_top_drivers else None,
                    shap_base_value,
                    datetime.utcnow(),
                ),
            )
            self.db_conn.commit()
            cursor.close()
            logger.debug(f"Logged prediction with SHAP: {player_id} {stat_type} {game_date}")
            return True
        except Exception as e:
            logger.warning(f"Failed to log prediction: {e}")
            try:
                self.db_conn.rollback()
            except:
                pass
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
        """Fill in post-game outcome for a previously logged prediction."""
        if self.db_conn is None:
            logger.debug("No DB connection - outcome not logged")
            return False

        try:
            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                SELECT line_value FROM {self.TABLE_NAME}
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
                """,
                (player_id, game_date, stat_type),
            )
            row = cursor.fetchone()
            if row is None:
                logger.warning(f"No prediction found to update: {player_id} {stat_type} {game_date}")
                cursor.close()
                return False

            line_value = float(row[0])
            hit = actual_value > line_value
            clv = None
            if closing_line is not None:
                clv = line_value - closing_line

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
            logger.debug(f"Logged outcome: {player_id} {stat_type} {game_date} actual={actual_value} hit={hit}")
            return True
        except Exception as e:
            logger.warning(f"Failed to log outcome: {e}")
            try:
                self.db_conn.rollback()
            except:
                pass
            return False

    def get_training_data(
        self,
        stat_type: Optional[str] = None,
        min_date: Optional[str] = None,
        max_date: Optional[str] = None,
        limit: int = 5000,
    ) -> list:
        """Retrieve labeled training data (predictions with outcomes).

        Returns rows with a 'source' field: 'real' for actual settled outcomes,
        'synthetic' for bootstrapped data. Callers can use this to apply
        differential sample weights during training.
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

            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                SELECT player_id, game_date, stat_type, line_value,
                       features, actual_value, hit, signal_score, edge_total,
                       predicted_direction, confidence_tier,
                       COALESCE(source, 'real') AS source
                FROM {self.TABLE_NAME}
                WHERE {where_clause}
                ORDER BY game_date ASC
                LIMIT %s
                """,
                params + [limit],
            )

            rows = cursor.fetchall()
            columns = [desc[0] for desc in cursor.description]
            cursor.close()

            results = []
            for row in rows:
                data = dict(zip(columns, row))
                features = data.get("features", {})
                if isinstance(features, str):
                    features = json.loads(features)

                hit_val = data["hit"]
                results.append({
                    "player_id": data["player_id"],
                    "game_date": str(data["game_date"]),
                    "stat_type": data["stat_type"],
                    "line": float(data["line_value"]),
                    "features": features,
                    "actual_value": float(data["actual_value"]),
                    "hit": hit_val,
                    # "target" is the key XGBoostPropModel._build_matrices expects (int 0/1)
                    "target": int(bool(hit_val)) if hit_val is not None else None,
                    "signal_score": float(data.get("signal_score") or 0),
                    "edge_total": float(data.get("edge_total") or 0),
                    "predicted_direction": data.get("predicted_direction", "OVER"),
                    "source": data.get("source", "real"),
                })

            return results
        except Exception as e:
            logger.warning(f"Failed to get training data: {e}")
            return []

    def get_shap_for_prediction(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve stored SHAP explanation for a specific prediction."""
        if self.db_conn is None:
            return None

        try:
            cursor = self.db_conn.cursor()
            cursor.execute(
                f"""
                SELECT shap_top_drivers, shap_base_value, model_prob,
                       calibration_method, line_value, predicted_direction
                FROM {self.TABLE_NAME}
                WHERE player_id = %s AND game_date = %s AND stat_type = %s
                """,
                (player_id, game_date, stat_type),
            )
            row = cursor.fetchone()
            cursor.close()

            if row is None:
                return None

            shap_drivers = row[0]
            if isinstance(shap_drivers, str):
                shap_drivers = json.loads(shap_drivers)

            return {
                "shap_top_drivers": shap_drivers or [],
                "shap_base_value": float(row[1]) if row[1] is not None else None,
                "model_prob": float(row[2]) if row[2] is not None else None,
                "calibration_method": row[3],
                "line_value": float(row[4]),
                "predicted_direction": row[5],
            }
        except Exception as e:
            logger.warning(f"Failed to get SHAP data: {e}")
            return None
