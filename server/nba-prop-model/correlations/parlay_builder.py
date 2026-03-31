"""
Correlated Parlay Builder

Scans today's high-confidence props, generates all N-leg combinations,
scores each via correlation-adjusted EV, and writes the top results to
parlay_results.

PrizePicks prices every prop as statistically independent.  This module
exploits the cases where legs are positively correlated — their joint
hit probability exceeds what the platform assumes, giving a free +EV edge.

Entry point: CorrelatedParlayBuilder.find_optimal_parlays()
Cron target: daily 10:30 AM (after projection_engine.run_daily())
"""

import decimal
import heapq
import itertools
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple


class _DecimalEncoder(json.JSONEncoder):
    """JSON encoder that converts Decimal to float."""
    def default(self, obj):
        if isinstance(obj, decimal.Decimal):
            return float(obj)
        return super().default(obj)

from .correlation_engine import CorrelationEngine

logger = logging.getLogger(__name__)

# ── PrizePicks payouts by leg count ──────────────────────────────────────────
PRIZEPICKS_PAYOUTS: Dict[int, float] = {
    2: 3.0,
    3: 5.0,
    4: 10.0,
    5: 20.0,
    6: 25.0,
}

# ── Confidence tiers eligible for parlay legs ─────────────────────────────────
ELIGIBLE_TIERS = ("SMASH", "STRONG", "LEAN")

# ── Recommendation thresholds ────────────────────────────────────────────────
RECOMMENDATION_THRESHOLDS = [
    ("SMASH",  0.15),   # 15%+ EV
    ("STRONG", 0.08),   # 8-15% EV
    ("LEAN",   0.02),   # 2-8% EV
    ("AVOID",  float("-inf")),  # negative EV — flag but record
]

# ── Avoid patterns ────────────────────────────────────────────────────────────
# Parlays that look correlated but are actually traps
AVOID_PATTERNS = [
    # Two players that are the SAME player (edge case)
    "SAME_PLAYER",
    # Negative correlation > 0.35 (legs tend to cancel)
    "STRONG_NEGATIVE_CORRELATION",
    # All legs on the same stat for the same team (over-concentration)
    "SAME_TEAM_SAME_STAT_OVERLOAD",
    # Mix of OVER and UNDER on same game total (conflicting)
    "CONFLICTING_GAME_TOTAL_DIRECTION",
]

# DB helper reused from projection_engine pattern ─────────────────────────────

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


class CorrelatedParlayBuilder:
    """
    Generates optimal correlated parlay recommendations for a given game date.

    Usage:
        builder = CorrelatedParlayBuilder()
        parlays = builder.find_optimal_parlays("2026-03-19", parlay_size=2)
    """

    def __init__(self, conn=None):
        self._conn = conn
        self._owns_conn = conn is None
        self._engine = CorrelationEngine(conn=conn)

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

    # ── Main public API ────────────────────────────────────────────────────

    def find_optimal_parlays(
        self,
        game_date: str,
        parlay_size: int = 2,
        min_ev: float = 0.05,
        max_results: int = 20,
    ) -> List[Dict[str, Any]]:
        """
        Find the best correlated parlays for a given game date.

        Steps:
        1. Pull eligible props from projection_outputs (SMASH/STRONG/LEAN)
        2. Generate all parlay_size combinations
        3. Score each via _score_parlay()
        4. Filter to combined_ev > min_ev
        5. Sort by combined_ev DESC, keep top max_results
        6. Write all results to parlay_results
        7. Return the top list

        Args:
            game_date:    YYYY-MM-DD string
            parlay_size:  Number of legs (2–6)
            min_ev:       Minimum combined_ev to return (default 5%)
            max_results:  Maximum number of parlays to return

        Returns:
            List of scored parlay dicts ordered by combined_ev DESC.
        """
        if parlay_size not in PRIZEPICKS_PAYOUTS:
            raise ValueError(
                f"parlay_size must be one of {list(PRIZEPICKS_PAYOUTS.keys())}"
            )

        conn = self._get_conn()
        props = self._fetch_eligible_props(game_date, conn)
        self._release_conn(conn)

        # Deduplicate by player_id — keep the highest-confidence prop per player
        # so that no player can appear twice in any generated combination.
        seen_player_ids: dict = {}
        for prop in sorted(props, key=lambda p: float(p.get("edge_pct", 0) or 0), reverse=True):
            pid = str(prop.get("player_id", ""))
            if pid and pid not in seen_player_ids:
                seen_player_ids[pid] = prop
        props = list(seen_player_ids.values())
        logger.info(
            f"find_optimal_parlays: {len(props)} unique-player props available "
            f"for {game_date} (after player dedup)"
        )

        if len(props) < parlay_size:
            logger.info(
                f"find_optimal_parlays: only {len(props)} eligible props on "
                f"{game_date}, need at least {parlay_size}"
            )
            return []

        # Cap eligible props by parlay size to prevent combinatorial explosion
        # C(40,3)=9880, C(25,4)=12650, C(18,5)=8568, C(15,6)=5005
        MAX_PROPS_BY_SIZE = {2: 150, 3: 40, 4: 25, 5: 18, 6: 15}
        max_eligible = MAX_PROPS_BY_SIZE.get(parlay_size, 15)
        if len(props) > max_eligible:
            props.sort(key=lambda p: float(p.get("edge_pct", 0) or 0), reverse=True)
            props = props[:max_eligible]
            logger.info(f"find_optimal_parlays: capped to top {max_eligible} props by edge (size={parlay_size})")

        from math import comb
        total_combos = comb(len(props), parlay_size)
        logger.info(
            f"find_optimal_parlays: scoring C({len(props)},{parlay_size}) = "
            f"{total_combos} combos"
        )

        # Use a heap to keep only top max_results in memory
        TOP_N = max_results * 2  # keep extra for filtering
        top_heap = []  # min-heap of (combined_ev, counter, result)
        counter = 0
        processed = 0

        # Reuse a single DB connection for all correlation lookups
        import time as _time
        scoring_conn = self._get_conn()
        scoring_engine = CorrelationEngine(conn=scoring_conn)
        _start = _time.time()
        _TIMEOUT_SECS = 90  # hard cap to prevent zombie processes

        for combo in itertools.combinations(props, parlay_size):
            if processed % 1000 == 0 and _time.time() - _start > _TIMEOUT_SECS:
                logger.warning(
                    f"find_optimal_parlays: timeout after {processed}/{total_combos} "
                    f"combos ({_TIMEOUT_SECS}s), returning partial results"
                )
                break
            result = self._score_parlay(combo, game_date, engine=scoring_engine)
            if result is not None:
                counter += 1
                ev = result["combined_ev"]
                if len(top_heap) < TOP_N:
                    heapq.heappush(top_heap, (ev, counter, result))
                elif ev > top_heap[0][0]:
                    heapq.heapreplace(top_heap, (ev, counter, result))
            processed += 1
            if processed % 10000 == 0:
                elapsed = _time.time() - _start
                logger.info(f"  processed {processed}/{total_combos} combos ({elapsed:.1f}s)")

        # Release the shared scoring connection
        try:
            scoring_conn.close()
        except Exception:
            pass

        # Extract results sorted by EV descending
        scored = [item[2] for item in sorted(top_heap, key=lambda x: x[0], reverse=True)]
        top = [p for p in scored if p["combined_ev"] > min_ev][:max_results]

        # Write all scored parlays (including below threshold) so avoid reasons
        # are available for analysis
        all_to_write = scored[:max_results * 3]  # write up to 3x for coverage
        self._write_parlay_results(all_to_write, game_date, leg_count=parlay_size)

        logger.info(
            f"find_optimal_parlays: {len(top)} parlays above EV>{min_ev:.0%} "
            f"(of {len(scored)} scored)"
        )
        return top

    # ── Scoring ────────────────────────────────────────────────────────────

    def _score_parlay(
        self, props_tuple: Tuple[Dict, ...], game_date: str,
        engine=None,
    ) -> Optional[Dict[str, Any]]:
        """
        Score a single parlay combination.

        Returns a dict ready for parlay_results, or None on error.
        """
        try:
            legs = list(props_tuple)

            # 1. Base hit probability (product of individual hit probs)
            individual_probs = [leg.get("hit_prob", 0.5) for leg in legs]
            base_hit_prob = 1.0
            for p in individual_probs:
                base_hit_prob *= max(0.01, min(0.99, p))

            # 2. Pairwise correlations
            pairwise_correlations: List[float] = []
            correlation_details: List[Dict[str, Any]] = []

            for i in range(len(legs)):
                for j in range(i + 1, len(legs)):
                    leg_a = legs[i]
                    leg_b = legs[j]
                    stat = self._normalise_stat(
                        leg_a.get("stat_type", "pts"),
                        leg_b.get("stat_type", "pts"),
                    )
                    _eng = engine or self._engine
                    corr = _eng.get_correlation(
                        str(leg_a["player_id"]),
                        str(leg_b["player_id"]),
                        stat,
                    )
                    pairwise_correlations.append(corr)
                    correlation_details.append(
                        {
                            "pair": (
                                leg_a.get("player_name", leg_a["player_id"]),
                                leg_b.get("player_name", leg_b["player_id"]),
                            ),
                            "stat": stat,
                            "correlation": round(corr, 3),
                            "relationship": self._relationship_label(corr),
                            "ev_adjustment": round(corr * 0.08, 4),
                            "same_team": leg_a.get("team") == leg_b.get("team"),
                            "same_game": leg_a.get("game_id") == leg_b.get("game_id"),
                        }
                    )

            # 3. Correlation-adjusted hit probability
            total_adj = sum(corr * 0.08 for corr in pairwise_correlations)
            true_hit_prob = base_hit_prob + (base_hit_prob * total_adj)
            true_hit_prob = max(0.01, min(0.99, true_hit_prob))

            # 4. Payout and EV
            payout = PRIZEPICKS_PAYOUTS[len(legs)]
            combined_ev = (true_hit_prob * payout) - 1.0

            # 5. Classify parlay type
            avg_corr = (
                sum(pairwise_correlations) / len(pairwise_correlations)
                if pairwise_correlations
                else 0.0
            )
            if avg_corr > 0.15:
                parlay_type = "CORRELATED_POSITIVE"
            elif avg_corr < -0.15:
                parlay_type = "CORRELATED_NEGATIVE"
            else:
                parlay_type = "INDEPENDENT"

            # 6. Detect template
            parlay_template = self._detect_template(legs, correlation_details)

            # 7. Check avoid patterns
            avoid_reason = self._check_avoid_patterns(
                legs, pairwise_correlations, correlation_details
            )

            # 8. Recommendation
            recommendation = self._get_recommendation(combined_ev, avoid_reason)

            # 9. Build leg payloads for storage
            leg_payloads = [
                {
                    "player_id": leg["player_id"],
                    "player_name": leg.get("player_name", ""),
                    "team": leg.get("team", ""),
                    "stat": leg.get("stat_type", ""),
                    "line": leg.get("line"),
                    "projection": leg.get("final_projection"),
                    "edge": leg.get("edge_pct"),
                    "hit_prob": leg.get("hit_prob"),
                    "direction": leg.get("direction", "OVER"),
                    "confidence_tier": leg.get("confidence_tier", ""),
                }
                for leg in legs
            ]

            return {
                "legs": leg_payloads,
                "correlations": correlation_details,
                "parlay_type": parlay_type,
                "parlay_template": parlay_template,
                "leg_count": len(legs),
                "base_hit_prob": round(base_hit_prob, 4),
                "true_hit_prob": round(true_hit_prob, 4),
                "payout": payout,
                "combined_ev": round(combined_ev, 4),
                "recommendation": recommendation,
                "avoid_reason": avoid_reason,
                "outcome": None,
                "payout_received": None,
            }

        except Exception as e:
            logger.warning(f"Error scoring parlay: {e}")
            return None

    # ── Template & pattern detection ───────────────────────────────────────

    def _detect_template(
        self, legs: List[Dict], corr_details: List[Dict]
    ) -> str:
        """
        Classify the parlay into one of the known template types:
            PACE_STACK       — high-total game, same-game players piling up stats
            INJURY_STACK     — teammate(s) absorbing usage from an injured star
            DEFENSE_EXPLOIT  — multiple players vs same poor defense
            FADE_STACK       — negative correlation play (one benefits when other falls)
        """
        teams = [leg.get("team", "") for leg in legs]
        game_ids = [leg.get("game_id", "") for leg in legs]
        stats = [leg.get("stat_type", "").lower() for leg in legs]
        injury_flags = [leg.get("injury_context", False) for leg in legs]
        opponents = [leg.get("opponent", "") for leg in legs]

        # FADE_STACK: majority of pairs are negatively correlated
        negative_pairs = sum(
            1 for cd in corr_details if cd.get("correlation", 0) < -0.15
        )
        if negative_pairs > len(corr_details) / 2:
            return "FADE_STACK"

        # INJURY_STACK: legs tagged as benefiting from teammate injury
        if any(injury_flags):
            return "INJURY_STACK"

        # PACE_STACK: same-game players, high-total context
        same_game = len(set(gid for gid in game_ids if gid)) == 1
        same_team = len(set(t for t in teams if t)) == 1
        if same_game and same_team:
            # If all legs are offensive stats in a same-game stack → PACE_STACK
            offensive_stats = {"pts", "ast", "3pm", "pra", "pa"}
            if all(s in offensive_stats for s in stats):
                return "PACE_STACK"

        # DEFENSE_EXPLOIT: multiple players facing same weak opponent
        unique_opponents = set(o for o in opponents if o)
        if len(unique_opponents) == 1 and len(legs) >= 2:
            return "DEFENSE_EXPLOIT"

        # Default: PACE_STACK for same-game positive correlations
        if same_game:
            return "PACE_STACK"

        return "PACE_STACK"  # generic fallback

    def _check_avoid_patterns(
        self,
        legs: List[Dict],
        pairwise_correlations: List[float],
        corr_details: List[Dict],
    ) -> Optional[str]:
        """
        Check for patterns that disqualify or flag a parlay.

        Returns a reason string if the parlay should be flagged AVOID,
        or None if it's clean.
        """
        player_ids = [str(leg.get("player_id", "")) for leg in legs]

        # 1. Same player appears twice
        if len(player_ids) != len(set(player_ids)):
            return "Duplicate player in parlay legs"

        # 2. Strong negative correlation between any pair
        for cd in corr_details:
            if cd.get("correlation", 0) < -0.35:
                pair = cd.get("pair", ("?", "?"))
                return (
                    f"Strong negative correlation ({cd['correlation']:.2f}) between "
                    f"{pair[0]} and {pair[1]} — legs tend to cancel"
                )

        # 3. Same-team same-stat overload (3+ legs)
        team_stat_combos = [
            (leg.get("team", ""), leg.get("stat_type", ""))
            for leg in legs
        ]
        from collections import Counter
        team_stat_counts = Counter(
            (t, s) for t, s in team_stat_combos if t and s
        )
        for (team, stat), count in team_stat_counts.items():
            if count >= 3:
                return (
                    f"Over-concentrated: {count} legs on {stat} for {team} "
                    f"— reduces independence assumption"
                )

        # 4. Conflicting OVER/UNDER on same game (one implies more scoring,
        #    other implies less — illogical in same-game stack)
        game_directions: Dict[str, List[str]] = {}
        for leg in legs:
            gid = leg.get("game_id", "")
            direction = leg.get("direction", "OVER")
            if gid:
                game_directions.setdefault(gid, []).append(direction)

        for gid, directions in game_directions.items():
            if "OVER" in directions and "UNDER" in directions:
                # Only flag if same team (opponent pitting OVER vs UNDER
                #  across teams is acceptable)
                same_team_legs = [
                    leg for leg in legs if leg.get("game_id") == gid
                ]
                teams_in_game = set(l.get("team", "") for l in same_team_legs)
                if len(teams_in_game) == 1:
                    return (
                        "Conflicting OVER/UNDER directions for same-team same-game legs"
                    )

        return None

    # ── Helpers ────────────────────────────────────────────────────────────

    def _fetch_eligible_props(self, game_date: str, conn) -> List[Dict[str, Any]]:
        """
        Pull eligible props for the given game_date.

        Primary source: projection_outputs JOIN prizepicks_daily_lines
        (populated by the 10 AM projection cron).

        Fallback: potential_bets table (live PrizePicks lines refreshed via
        /api/bets/refresh).  Used when projection_outputs has no rows for
        game_date so that parlays reflect today's current lines even if the
        projection engine hasn't run yet.

        Filters to confidence_tier IN ('SMASH', 'STRONG', 'LEAN').
        Computes hit_prob from edge_pct (edge_pct → probability over 50%).
        """
        if conn is None:
            return []

        import math

        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT
                    po.player_id,
                    COALESCE(pdl.player_name, po.player_id::text) AS player_name,
                    po.prop_type        AS stat_type,
                    po.final_projection,
                    po.prizepicks_line  AS line,
                    po.edge_pct,
                    po.confidence_tier,
                    CASE
                        WHEN po.final_projection > po.prizepicks_line THEN 'OVER'
                        ELSE 'UNDER'
                    END AS direction,
                    po.kelly_stake,
                    pdl.team,
                    pdl.opponent,
                    CONCAT(pdl.team, '_vs_', pdl.opponent) AS game_id
                FROM projection_outputs po
                LEFT JOIN prizepicks_daily_lines pdl
                    ON pdl.prizepicks_player_id::text = po.player_id
                    AND pdl.game_date = po.game_date
                    AND pdl.stat_type = po.prop_type
                WHERE po.game_date = %s
                  AND po.confidence_tier = ANY(%s)
                  AND po.prizepicks_line IS NOT NULL
                ORDER BY po.edge_pct DESC
                """,
                (game_date, list(ELIGIBLE_TIERS)),
            )
            rows = cursor.fetchall()
            cols = [desc[0] for desc in cursor.description]
            cursor.close()

            if rows:
                props = []
                for row in rows:
                    prop = dict(zip(cols, row))
                    edge = float(prop.get("edge_pct") or 0.0)
                    prop["hit_prob"] = max(0.01, min(0.99, 1.0 / (1.0 + math.exp(-edge / 50.0))))
                    props.append(prop)
                logger.info(
                    f"_fetch_eligible_props: {len(props)} props from projection_outputs "
                    f"for {game_date}"
                )
                return props

            # ── Fallback: read live potential_bets (today's PrizePicks lines) ──
            logger.info(
                f"_fetch_eligible_props: no projection_outputs rows for {game_date}, "
                "falling back to potential_bets"
            )
            cursor2 = conn.cursor()
            cursor2.execute(
                """
                SELECT
                    pb.player_id,
                    pb.player_name,
                    pb.stat_type,
                    pb.season_avg       AS final_projection,
                    pb.line,
                    COALESCE(pb.edge_score, 0)  AS edge_pct,
                    COALESCE(pb.confidence_tier,
                        CASE pb.confidence
                            WHEN 'HIGH'   THEN 'STRONG'
                            WHEN 'MEDIUM' THEN 'LEAN'
                            ELSE               'LEAN'
                        END
                    )                   AS confidence_tier,
                    pb.recommendation   AS direction,
                    COALESCE(pb.kelly_size, 0) AS kelly_stake,
                    pb.team,
                    NULL::text          AS opponent,
                    pb.team             AS game_id
                FROM potential_bets pb
                WHERE COALESCE(pb.confidence_tier,
                        CASE pb.confidence
                            WHEN 'HIGH'   THEN 'STRONG'
                            WHEN 'MEDIUM' THEN 'LEAN'
                            ELSE               'LEAN'
                        END
                      ) = ANY(%s)
                  AND pb.line IS NOT NULL
                ORDER BY COALESCE(pb.edge_score, 0) DESC
                """,
                (list(ELIGIBLE_TIERS),),
            )
            rows2 = cursor2.fetchall()
            cols2 = [desc[0] for desc in cursor2.description]
            cursor2.close()

            props = []
            for row in rows2:
                prop = dict(zip(cols2, row))
                edge = float(prop.get("edge_pct") or 0.0)
                prop["hit_prob"] = max(0.01, min(0.99, 1.0 / (1.0 + math.exp(-edge / 50.0))))
                props.append(prop)

            logger.info(
                f"_fetch_eligible_props: {len(props)} props from potential_bets fallback"
            )
            return props

        except Exception as e:
            logger.error(f"_fetch_eligible_props failed for {game_date}: {e}")
            return []

    def _normalise_stat(self, stat_a: str, stat_b: str) -> str:
        """
        Choose which stat to correlate on when two legs use different stats.

        Preference: pts > reb > ast > 3pm > pra
        """
        priority = {"pts": 0, "reb": 1, "ast": 2, "3pm": 3, "pra": 4, "ptsrebs": 5, "ptsasts": 6, "rebsasts": 7, "blksstls": 8}
        a = stat_a.lower().replace("-", "").replace("+", "").replace(" ", "")
        b = stat_b.lower().replace("-", "").replace("+", "").replace(" ", "")
        # Normalise common aliases
        alias = {
            "points": "pts", "rebounds": "reb", "assists": "ast",
            "3pointersm": "3pm", "3pointersmade": "3pm",
            "ptsrebsasts": "pra", "pra": "pra",
            "ptsrebs": "ptsrebs", "ptsasts": "ptsasts",
            "rebsasts": "rebsasts", "blksstls": "blksstls",
        }
        a = alias.get(a, a)
        b = alias.get(b, b)
        if a == b:
            return a
        return a if priority.get(a, 99) <= priority.get(b, 99) else b

    def _relationship_label(self, corr: float) -> str:
        if corr > 0.35:
            return "STRONG_POSITIVE"
        if corr > 0.15:
            return "WEAK_POSITIVE"
        if corr < -0.35:
            return "STRONG_NEGATIVE"
        if corr < -0.15:
            return "WEAK_NEGATIVE"
        return "NEUTRAL"

    def _get_recommendation(self, combined_ev: float, avoid_reason: Optional[str]) -> str:
        if avoid_reason:
            return "AVOID"
        for label, threshold in RECOMMENDATION_THRESHOLDS:
            if combined_ev >= threshold:
                return label
        return "SKIP"

    def _write_parlay_results(
        self, parlays: List[Dict[str, Any]], game_date: str,
        leg_count: int = 0,
    ) -> int:
        """Upsert parlay results into parlay_results table. Returns rows written."""
        if not parlays:
            return 0

        conn = self._get_conn()
        if conn is None:
            logger.error("No DB connection for _write_parlay_results")
            return 0

        written = 0
        try:
            cursor = conn.cursor()
            # Clear existing results for this date to avoid duplicates on re-run
            if leg_count > 0:
                cursor.execute(
                    "DELETE FROM parlay_results WHERE game_date = %s AND leg_count = %s AND outcome IS NULL",
                    (game_date, leg_count),
                )
            else:
                cursor.execute(
                    "DELETE FROM parlay_results WHERE game_date = %s AND outcome IS NULL",
                    (game_date,),
                )
            for p in parlays:
                cursor.execute(
                    """
                    INSERT INTO parlay_results (
                        legs, correlations, parlay_type, parlay_template,
                        leg_count, base_hit_prob, true_hit_prob, payout,
                        combined_ev, recommendation, avoid_reason,
                        outcome, payout_received, game_date
                    ) VALUES (
                        %s, %s, %s, %s,
                        %s, %s, %s, %s,
                        %s, %s, %s,
                        %s, %s, %s
                    )
                    """,
                    (
                        json.dumps(p["legs"], cls=_DecimalEncoder),
                        json.dumps(p["correlations"], cls=_DecimalEncoder),
                        p["parlay_type"],
                        p["parlay_template"],
                        p["leg_count"],
                        p["base_hit_prob"],
                        p["true_hit_prob"],
                        p["payout"],
                        p["combined_ev"],
                        p["recommendation"],
                        p.get("avoid_reason"),
                        p.get("outcome"),
                        p.get("payout_received"),
                        game_date,
                    ),
                )
                written += 1

            conn.commit()
            cursor.close()
            logger.info(f"Wrote {written} parlay results for {game_date}")

        except Exception as e:
            logger.error(f"_write_parlay_results failed: {e}")
            try:
                conn.rollback()
            except Exception:
                pass

        self._release_conn(conn)
        return written
