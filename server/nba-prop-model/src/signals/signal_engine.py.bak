"""
Signal Engine — master orchestrator for all NBA prop signals.

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
    absent_players: List[str] = field(default_factory=list)   # list of player_ids
    referee_crew: List[str] = field(default_factory=list)     # list of referee names
    # Optional context extras (position, rest days, season averages, etc.)
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
    weighted_delta: float          # total weighted projection adjustment (as fraction)
    direction: Optional[str]       # 'OVER', 'UNDER', or None
    confidence_tier: str           # 'SMASH', 'STRONG', 'LEAN', 'SKIP'
    signals_fired: List[Dict[str, Any]]   # list of fired signal dicts
    signals_skipped: List[str]            # signal names that didn't fire
    conflict_detected: bool               # True if opposing signals fired

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

    # Confidence tiers ordered highest → lowest (for downgrade logic)
    TIER_ORDER = ["SMASH", "STRONG", "LEAN", "SKIP"]

    def __init__(self, db_conn=None):
        self.db_conn = db_conn
        self._signals = self._load_signals()
        self._weights: Dict[str, float] = {}
        self._load_weights()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, game_context: GameContext) -> SignalEngineResult:
        """
        Run all signals for the given game context.

        Args:
            game_context: GameContext dataclass with all required fields.

        Returns:
            SignalEngineResult with weighted delta and metadata.
        """
        ctx = game_context.to_signal_context()
        raw_results: Dict[str, Any] = {}

        # Run each signal
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

        # Separate fired vs skipped
        fired = {k: v for k, v in raw_results.items() if v.fired}
        skipped = [k for k, v in raw_results.items() if not v.fired]

        # Detect conflicts (over vs under signals both firing)
        over_signals = [k for k, v in fired.items() if v.direction == "OVER"]
        under_signals = [k for k, v in fired.items() if v.direction == "UNDER"]
        conflict = len(over_signals) > 0 and len(under_signals) > 0

        # Weighted sum of deltas
        weighted_delta = 0.0
        for name, result in fired.items():
            weight = self._weights.get(name, 0.5)
            weighted_delta += result.adjustment * weight

        # Consensus direction
        if len(over_signals) > len(under_signals):
            direction = "OVER"
        elif len(under_signals) > len(over_signals):
            direction = "UNDER"
        else:
            direction = None

        # Base confidence tier
        aligned_count = max(len(over_signals), len(under_signals))
        if aligned_count >= 3 and not conflict:
            tier = "SMASH"
        elif aligned_count >= 2 and not conflict:
            tier = "STRONG"
        elif aligned_count >= 1:
            tier = "LEAN"
        else:
            tier = "SKIP"

        # Downgrade one level if conflict detected
        if conflict:
            tier = self._downgrade_tier(tier)

        # Serialize fired signals for output
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
        """Re-load weights from DB (call after bayesian_optimizer runs)."""
        self._load_weights()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _load_signals(self) -> Dict[str, Any]:
        """Import and instantiate all signal classes."""
        signals: Dict[str, Any] = {}

        def _try_import(module_path: str, class_name: str, signal_key: str):
            try:
                import importlib
                mod = importlib.import_module(module_path)
                cls = getattr(mod, class_name)
                signals[signal_key] = cls()
                logger.debug(f"Loaded signal: {signal_key}")
            except Exception as e:
                logger.warning(f"Could not load signal {signal_key}: {e}")

        _try_import("src.signals.positional_defense", "PositionalDefenseSignal", "positional_defense")
        _try_import("src.signals.rest_days", "RestDaysSignal", "rest_days")
        _try_import("src.signals.back_to_back", "BackToBackSignal", "b2b_fatigue")
        _try_import("src.signals.pace_matchup", "PaceMatchupSignal", "pace_matchup")
        _try_import("src.signals.injury_alpha", "InjuryAlphaSignal", "usage_redistribution")
        _try_import("src.signals.referee", "RefereeSignal", "ref_foul")
        _try_import("src.signals.fatigue", "FatigueSignal", "fatigue")
        _try_import("src.signals.recent_form", "RecentFormSignal", "recent_form")
        _try_import("src.signals.home_away", "HomeAwaySignal", "home_away")
        _try_import("src.signals.matchup_history", "MatchupHistorySignal", "matchup_history")
        _try_import("src.signals.line_movement", "LineMovementSignal", "line_movement")
        _try_import("src.signals.blowout_risk", "BlowoutRiskSignal", "blowout_risk")

        logger.info(f"Loaded {len(signals)} signals: {list(signals.keys())}")
        return signals

    def _load_weights(self) -> None:
        """Pull weights from weight_registry table. Falls back to 0.5 default."""
        if self.db_conn is None:
            logger.debug("No DB connection — using default weights (0.5)")
            return
        try:
            cursor = self.db_conn.cursor()
            cursor.execute("SELECT signal_type, weight FROM weight_registry")
            rows = cursor.fetchall()
            cursor.close()
            self._weights = {row[0]: float(row[1]) for row in rows if row[1] is not None}
            logger.debug(f"Loaded {len(self._weights)} weights from DB")
        except Exception as e:
            logger.warning(f"Could not load weights from DB: {e}")

    def _downgrade_tier(self, tier: str) -> str:
        """Drop confidence tier by one level."""
        try:
            idx = self.TIER_ORDER.index(tier)
            return self.TIER_ORDER[min(idx + 1, len(self.TIER_ORDER) - 1)]
        except ValueError:
            return "SKIP"


# ---------------------------------------------------------------------------
# CLI test entry point
# ---------------------------------------------------------------------------

def _run_test():
    """Quick smoke test — run engine with synthetic data, print JSON."""
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
