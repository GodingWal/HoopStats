"""
Signal Engine - master orchestrator for all NBA prop signals.

Usage:
    engine = SignalEngine(db_conn)
    result = engine.run(game_context)

Test:
    python -m src.signals.signal_engine --test
"""

import logging
import os
import sys
import json
import argparse
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# GameContext dataclass
# ---------------------------------------------------------------------------

@dataclass
class GameContext:
    """All information needed to run signals for one player/game/prop."""
    player_id: str
    team_id: str
    opp_team_id: str
    game_date: str           # YYYY-MM-DD
    prop_type: str           # e.g. "Points", "Rebounds"
    prizepicks_line: float
    absent_players: List[str] = field(default_factory=list)
    referee_crew: List[str] = field(default_factory=list)
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_signal_context(self) -> Dict[str, Any]:
        """Merge fixed fields + extra into a flat dict for signal.calculate()."""
        ctx = {
            "player_id": self.player_id,
            "team_id": self.team_id,
            "opp_team_id": self.opp_team_id,
            "game_date": self.game_date,
            "prop_type": self.prop_type,
            "prizepicks_line": self.prizepicks_line,
            "absent_players": self.absent_players,
            "referee_crew": self.referee_crew,
        }
        ctx.update(self.extra)
        return ctx


# ---------------------------------------------------------------------------
# SignalEngineResult
# ---------------------------------------------------------------------------

@dataclass
class SignalEngineResult:
    """Output from SignalEngine.run()."""
    weighted_delta: float
    direction: Optional[str]
    confidence_tier: str
    signals_fired: List[Dict[str, Any]]
    signals_skipped: List[str]
    conflict_detected: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "weighted_delta": self.weighted_delta,
            "direction": self.direction,
            "confidence_tier": self.confidence_tier,
            "signals_fired": self.signals_fired,
            "signals_skipped": self.signals_skipped,
            "conflict_detected": self.conflict_detected,
        }


# ---------------------------------------------------------------------------
# SignalEngine
# ---------------------------------------------------------------------------

class SignalEngine:
    """
    Master signal orchestrator.

    1. Runs all applicable signal modules.
    2. Pulls weights from the weight_registry DB table.
    3. Returns a weighted projection delta and fired signal list.
    4. Downgrades confidence tier when signals conflict.
    """

    TIER_ORDER = ["SMASH", "STRONG", "LEAN", "SKIP"]

    # Signals disabled due to low accuracy, sparse data, or redundancy.
    # These are skipped at load time and their weights are forced to 0.0.
    DISABLED_SIGNALS = {
        "defender_matchup",      # Hardcoded 24 players, ~5% fire rate, no proven accuracy
        "matchup_history",       # Sparse vs_team_history data
        "home_away",             # Home advantage too weak (~2 pts), ~50-53% accuracy
        "usage_redistribution",  # Dependent on injury_alpha — not independent
        "positional_defense",    # Redundant with defense signal
        "blowout_risk",          # 43% accuracy (worse than coin flip)
    }

    def __init__(self, db_conn=None):
        self.db_conn = db_conn
        self._signals = self._load_signals()
        self._weights: Dict[str, float] = {}
        self._load_weights()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, game_context: GameContext) -> SignalEngineResult:
        ctx = game_context.to_signal_context()
        raw_results: Dict[str, Any] = {}

        for name, signal in self._signals.items():
            if not signal.applies_to(game_context.prop_type):
                continue
            try:
                result = signal.calculate(
                    player_id=game_context.player_id,
                    game_date=game_context.game_date,
                    stat_type=game_context.prop_type,
                    context=ctx,
                )
                raw_results[name] = result
            except Exception as e:
                logger.warning(f"Signal {name} failed: {e}")

        fired = {k: v for k, v in raw_results.items() if v.fired}
        skipped = [k for k, v in raw_results.items() if not v.fired]

        over_signals = [k for k, v in fired.items() if v.direction == "OVER"]
        under_signals = [k for k, v in fired.items() if v.direction == "UNDER"]

        weighted_delta = 0.0
        for name, result in fired.items():
            weight = self._weights.get(name, 0.5)
            weighted_delta += result.adjustment * weight

        # Weighted vote totals — high-quality signals count more than weak ones.
        # A single line_movement (w=0.85) outweighs three b2b signals (w=0.55 each)
        # in terms of tier assignment, preventing low-quality SMASH calls.
        over_weight = sum(self._weights.get(k, 0.5) for k in over_signals)
        under_weight = sum(self._weights.get(k, 0.5) for k in under_signals)

        # Only flag a conflict when BOTH sides carry meaningful aligned weight.
        # Threshold is 0.75 (≈ 2 moderate-weight signals) so that a single
        # opposing signal doesn't suppress a strong consensus.  With the current
        # weight scale (max 0.55 per signal), 0.50 was too sensitive — a single
        # b2b vs a single recent_form would trigger conflict.
        conflict = over_weight > 0.75 and under_weight > 0.75

        if over_weight > under_weight:
            direction = "OVER"
            aligned_weight = over_weight
        elif under_weight > over_weight:
            direction = "UNDER"
            aligned_weight = under_weight
        else:
            direction = None
            aligned_weight = 0.0

        # Count of signals aligned in the winning direction
        if direction == "OVER":
            aligned_signals_count = len(over_signals)
        elif direction == "UNDER":
            aligned_signals_count = len(under_signals)
        else:
            aligned_signals_count = 0

        # Tier thresholds based on total aligned weight rather than raw signal count.
        # Calibrated for current weight scale (max ~0.55 per signal):
        #   SMASH  ≈ 4+ signals all aligned (4 × 0.50 = 2.00 ≥ 1.80)
        #   STRONG ≈ 2-3 signals aligned (2 × 0.55 = 1.10 ≥ 0.90)
        #   LEAN   ≈ 1-2 signals providing meaningful aligned weight
        #
        # SMASH additionally requires at least 4 signals to have actually fired.
        # A 2-signal SMASH is a statistical coincidence, not genuine conviction.
        # If the weight threshold is met but fewer than 4 signals fired, cap at STRONG.
        if aligned_weight >= 1.80 and not conflict and aligned_signals_count >= 4:
            tier = "SMASH"
        elif aligned_weight >= 0.90 and not conflict:
            tier = "STRONG"
        elif aligned_weight >= 0.45:
            tier = "LEAN"
        else:
            tier = "SKIP"

        if conflict:
            tier = self._downgrade_tier(tier)

        fired_list = [
            {
                "signal_name": name,
                "direction": v.direction,
                "adjustment": v.adjustment,
                "confidence": v.confidence,
                "weight": self._weights.get(name, 0.5),
                "weighted_contribution": v.adjustment * self._weights.get(name, 0.5),
                "metadata": v.metadata,
            }
            for name, v in fired.items()
        ]

        return SignalEngineResult(
            weighted_delta=round(weighted_delta, 4),
            direction=direction,
            confidence_tier=tier,
            signals_fired=fired_list,
            signals_skipped=skipped,
            conflict_detected=conflict,
        )

    def refresh_weights(self) -> None:
        self._load_weights()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load_signals(self) -> Dict[str, Any]:
        """Import and instantiate ALL signal classes with consistent naming."""
        signals: Dict[str, Any] = {}

        def _try_import(module_path: str, class_name: str, signal_key: str):
            if signal_key in self.DISABLED_SIGNALS:
                logger.debug(f"Signal {signal_key} is disabled — skipping")
                return
            try:
                import importlib
                mod = importlib.import_module(module_path)
                cls = getattr(mod, class_name)
                signals[signal_key] = cls()
                logger.debug(f"Loaded signal: {signal_key}")
            except Exception as e:
                logger.warning(f"Could not load signal {signal_key}: {e}")

        # Core signals (consistent naming matching __init__.py AVAILABLE_SIGNALS)
        _try_import("src.signals.back_to_back", "BackToBackSignal", "b2b")
        _try_import("src.signals.home_away", "HomeAwaySignal", "home_away")
        _try_import("src.signals.recent_form", "RecentFormSignal", "recent_form")
        _try_import("src.signals.pace_matchup", "PaceMatchupSignal", "pace")
        _try_import("src.signals.defense_vs_position", "DefenseVsPositionSignal", "defense")
        _try_import("src.signals.positional_defense", "PositionalDefenseSignal", "positional_defense")

        # FIX #1: usage_redistribution now correctly loads UsageRedistributionSignal
        _try_import("src.signals.usage_redistribution", "UsageRedistributionSignal", "usage_redistribution")

        # Injury alpha (separate from usage redistribution)
        _try_import("src.signals.injury_alpha", "InjuryAlphaSignal", "injury_alpha")

        # V2 signals
        _try_import("src.signals.defender_matchup", "DefenderMatchupSignal", "defender_matchup")
        _try_import("src.signals.line_movement", "LineMovementSignal", "line_movement")
        _try_import("src.signals.matchup_history", "MatchupHistorySignal", "matchup_history")
        _try_import("src.signals.fatigue", "FatigueSignal", "fatigue")
        _try_import("src.signals.rest_days", "RestDaysSignal", "rest_days")

        # NEW: Minutes projection signal
        _try_import("src.signals.minutes_projection", "MinutesProjectionSignal", "minutes_projection")

        # NEW: Win probability signal (game-level W/L model)
        _try_import("src.signals.win_probability", "WinProbabilitySignal", "win_probability")

        # NEW: Opponent recent form signal (signal #20)
        _try_import("src.signals.opponent_recent_form", "OpponentRecentFormSignal", "opponent_recent_form")

        logger.info(f"Loaded {len(signals)} signals: {list(signals.keys())}")
        return signals

    def _load_weights(self) -> None:
        """Pull weights from weight_registry table. Falls back to defaults.

        DEFAULT WEIGHT RATIONALE (audited 2026-04-03):
        Weights are calibrated against actual data coverage in the projection
        pipeline.  Signals that never receive their required context keys are set
        to 0.01 (essentially disabled until the data pipeline provides them).

        Signals disabled at 0.01 (no data flowing into them):
          - fatigue:         requires minutes_last_7/14 + recent_schedule — NOT in context
          - win_probability: requires team_net_rating + opp_net_rating — NOT in context
          - pace:            requires opponent_pace — NOT in context

        Signals with reduced weight (low coverage or no proven accuracy):
          - defender_matchup: hardcoded list of 24 players only (~5% coverage)
          - matchup_history:  depends on vs_team_history DB population
          - usage_redistribution: correlated with injury_alpha; reduce to avoid double-count
          - opponent_recent_form: depends on team_game_logs DB population

        Signals kept moderate (fire correctly when data present):
          - b2b, rest_days, recent_form, home_away, defense, positional_defense
          - injury_alpha, minutes_projection, line_movement
        """
        self._weights = {
            # ---- ACTIVE SIGNALS ----

            # Line movement: highest quality signal when it fires.
            "line_movement": 0.55,

            # Injury alpha: strong when absent_players data is present.
            "injury_alpha": 0.50,

            # Recent form: fires when L5 avg differs from season by 10%+.
            "recent_form": 0.45,

            # Win probability: game-level signal using team net ratings.
            "win_probability": 0.45,

            # Defense vs position: fires for teams where positional data is available.
            "defense": 0.45,

            # Minutes projection: fires when 'min' key is in averages dicts.
            "minutes_projection": 0.45,

            # Pace: requires opponent_pace in context.
            "pace": 0.40,

            # B2B: reliable, well-documented signal. Fires on ~15% of games.
            "b2b": 0.40,

            # Rest days: fires when game schedule data is in DB.
            "rest_days": 0.35,

            # Opponent recent form: fires when team_game_logs table is populated.
            "opponent_recent_form": 0.25,

            # Fatigue: requires schedule density + minutes load data not currently
            # injected into context. Kept low until pipeline provides this data.
            "fatigue": 0.01,

            # ---- DISABLED SIGNALS (weight=0, not loaded) ----
            "defender_matchup":     0.0,  # Hardcoded 24 players, ~5% fire rate
            "matchup_history":      0.0,  # Sparse data
            "home_away":            0.0,  # Home advantage too weak (~2 pts)
            "usage_redistribution": 0.0,  # Dependent on injury_alpha, not independent
            "positional_defense":   0.0,  # Redundant with defense
            "blowout_risk":         0.0,  # 43% accuracy
        }

        if self.db_conn is None:
            logger.warning(
                "SignalEngine: no DB connection — using hardcoded default weights. "
                "Run weight optimizer and ensure signal_weights table is populated "
                "for data-driven weights."
            )
            return
        try:
            cursor = self.db_conn.cursor()
            cursor.execute("""
                SELECT weights FROM signal_weights
                WHERE valid_until IS NULL
                ORDER BY calculated_at DESC
                LIMIT 1
            """)
            rows = cursor.fetchall()
            cursor.close()
            loaded = 0
            for row in rows:
                try:
                    import json as _json
                    w_data = _json.loads(row[0]) if isinstance(row[0], str) else row[0]
                    for signal_name, signal_data in w_data.items():
                        if isinstance(signal_data, dict) and 'weight' in signal_data:
                            self._weights[signal_name] = float(signal_data['weight'])
                            loaded += 1
                        elif isinstance(signal_data, (int, float)):
                            self._weights[signal_name] = float(signal_data)
                            loaded += 1
                except Exception as parse_err:
                    logger.warning(f"Could not parse signal_weights row: {parse_err}")
            logger.debug(f"Loaded {loaded} weights from signal_weights, merged with defaults")
        except Exception as e:
            logger.warning(f"Could not load weights from DB: {e}")

    def _downgrade_tier(self, tier: str) -> str:
        try:
            idx = self.TIER_ORDER.index(tier)
            return self.TIER_ORDER[min(idx + 1, len(self.TIER_ORDER) - 1)]
        except ValueError:
            return "SKIP"


# ---------------------------------------------------------------------------
# CLI test entry point
# ---------------------------------------------------------------------------

def _run_test():
    """Quick smoke test."""
    logging.basicConfig(level=logging.INFO)

    ctx = GameContext(
        player_id="test_player_1",
        team_id="BOS",
        opp_team_id="MIA",
        game_date="2025-11-15",
        prop_type="Points",
        prizepicks_line=28.5,
        absent_players=[],
        referee_crew=["Scott Foster", "Tony Brothers"],
        extra={
            "position": "PG",
            "rest_days": 0,
            "opp_rest_days": 1,
            "season_averages": {"pts": 30.2, "reb": 5.1, "ast": 6.3},
            "last_5_averages": {"pts": 31.0, "reb": 5.3, "ast": 6.0},
            "home_game": True,
        },
    )

    engine = SignalEngine(db_conn=None)
    result = engine.run(ctx)
    print(json.dumps(result.to_dict(), indent=2))
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Signal Engine")
    parser.add_argument("--test", action="store_true", help="Run smoke test")
    args = parser.parse_args()
    if args.test:
        _run_test()
    else:
        parser.print_help()
