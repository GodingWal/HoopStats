"""
Betting Strategy Module

Implements calibrated Kelly criterion, edge decay filters, and tiered bet sizing
for optimal bankroll management with XGBoost model predictions.

Key features:
1. Kelly criterion with calibrated probabilities and confidence-adjusted fraction
2. Edge decay: require larger edges for stale lines and high-variance stats
3. Tiered bet sizing based on confidence and edge magnitude
4. Bankroll protection: max drawdown circuit breaker
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass, field
import math


@dataclass
class BetRecommendation:
    """Output from betting strategy evaluation."""
    should_bet: bool
    direction: str  # "OVER" or "UNDER"
    edge: float  # model_prob - implied_prob
    kelly_fraction: float  # raw Kelly fraction
    bet_size_pct: float  # final recommended bet as % of bankroll
    confidence_tier: str  # "HIGH", "MEDIUM", "LOW", "PASS"
    model_prob: float
    implied_prob: float
    reasoning: str = ""


# Minimum edge thresholds per stat type — high-variance stats need bigger edges
DEFAULT_MIN_EDGE_BY_STAT = {
    "Points": 0.030,           # 3.0% — most stable
    "Rebounds": 0.035,          # 3.5%
    "Assists": 0.040,           # 4.0% — higher variance
    "3-Pointers Made": 0.055,   # 5.5% — very high variance
    "Steals": 0.060,            # 6.0% — extremely sparse
    "Blocks": 0.060,            # 6.0% — extremely sparse
    "Turnovers": 0.045,         # 4.5%
    "Pts+Rebs+Asts": 0.030,    # 3.0% — diversified combo
}

# Tiered bet sizing
CONFIDENCE_TIERS = {
    "HIGH": {"min_prob": 0.62, "min_edge": 0.06, "kelly_mult": 0.40, "max_pct": 0.020},
    "MEDIUM": {"min_prob": 0.57, "min_edge": 0.03, "kelly_mult": 0.30, "max_pct": 0.015},
    "LOW": {"min_prob": 0.53, "min_edge": 0.03, "kelly_mult": 0.20, "max_pct": 0.010},
}


class BettingStrategy:
    """
    Advanced betting strategy combining calibrated Kelly criterion
    with edge decay and tiered position sizing.
    """

    def __init__(
        self,
        base_kelly_fraction: float = 0.25,
        max_bet_pct: float = 0.02,
        min_edge_by_stat: Optional[Dict[str, float]] = None,
        max_drawdown_pct: float = 0.15,
        edge_decay_hours: float = 12.0,
        edge_decay_multiplier: float = 1.5,
    ):
        """
        Args:
            base_kelly_fraction: Fraction of Kelly to bet (0.25 = quarter Kelly)
            max_bet_pct: Maximum bet as percentage of bankroll
            min_edge_by_stat: Minimum edge thresholds per stat type
            max_drawdown_pct: Circuit breaker — pause if drawdown exceeds this
            edge_decay_hours: After this many hours, require larger edge
            edge_decay_multiplier: Multiply min edge by this for stale lines
        """
        self.base_kelly_fraction = base_kelly_fraction
        self.max_bet_pct = max_bet_pct
        self.min_edge_by_stat = min_edge_by_stat or DEFAULT_MIN_EDGE_BY_STAT
        self.max_drawdown_pct = max_drawdown_pct
        self.edge_decay_hours = edge_decay_hours
        self.edge_decay_multiplier = edge_decay_multiplier

    def evaluate_bet(
        self,
        model_prob: float,
        implied_prob: float,
        stat_type: str,
        odds: float = -110.0,
        line_age_hours: float = 0.0,
        player_clv_history: float = 0.0,
        current_drawdown_pct: float = 0.0,
    ) -> BetRecommendation:
        """
        Evaluate whether to place a bet and how much to risk.

        Args:
            model_prob: Calibrated model probability of over
            implied_prob: Implied probability from sportsbook odds
            stat_type: Stat type (e.g. "Points", "3-Pointers Made")
            odds: American odds (e.g. -110)
            line_age_hours: Hours since line was first posted
            player_clv_history: Player's historical CLV (positive = good)
            current_drawdown_pct: Current drawdown as % of peak bankroll

        Returns:
            BetRecommendation with sizing and tier
        """
        # Determine direction
        if model_prob >= 0.5:
            direction = "OVER"
            edge = model_prob - implied_prob
            prob = model_prob
        else:
            direction = "UNDER"
            edge = (1 - model_prob) - (1 - implied_prob)
            prob = 1 - model_prob

        # Edge decay for stale lines — market has had time to correct
        min_edge = self.min_edge_by_stat.get(stat_type, 0.03)
        if line_age_hours > self.edge_decay_hours:
            decay_factor = 1.0 + (self.edge_decay_multiplier - 1.0) * min(
                (line_age_hours - self.edge_decay_hours) / self.edge_decay_hours, 1.0
            )
            min_edge *= decay_factor

        # CLV-based filter: if player historically has negative CLV, require more edge
        if player_clv_history < -0.02:
            min_edge *= 1.25

        # Drawdown circuit breaker
        if current_drawdown_pct > self.max_drawdown_pct:
            return BetRecommendation(
                should_bet=False,
                direction=direction,
                edge=edge,
                kelly_fraction=0.0,
                bet_size_pct=0.0,
                confidence_tier="PASS",
                model_prob=model_prob,
                implied_prob=implied_prob,
                reasoning=f"Drawdown circuit breaker: {current_drawdown_pct:.1%} > {self.max_drawdown_pct:.1%}",
            )

        # Check minimum edge
        if edge < min_edge:
            return BetRecommendation(
                should_bet=False,
                direction=direction,
                edge=edge,
                kelly_fraction=0.0,
                bet_size_pct=0.0,
                confidence_tier="PASS",
                model_prob=model_prob,
                implied_prob=implied_prob,
                reasoning=f"Edge {edge:.3f} below minimum {min_edge:.3f} for {stat_type}",
            )

        # Compute Kelly criterion
        decimal_odds = self._american_to_decimal(odds)
        kelly = self._kelly_criterion(prob, decimal_odds)

        # Determine confidence tier and apply tier-specific sizing
        tier, tier_config = self._get_confidence_tier(prob, edge)

        if tier == "PASS":
            return BetRecommendation(
                should_bet=False,
                direction=direction,
                edge=edge,
                kelly_fraction=kelly,
                bet_size_pct=0.0,
                confidence_tier="PASS",
                model_prob=model_prob,
                implied_prob=implied_prob,
                reasoning=f"Below minimum tier thresholds",
            )

        # Apply tier-specific Kelly multiplier and cap
        kelly_mult = tier_config["kelly_mult"]
        tier_max = tier_config["max_pct"]
        bet_size = min(kelly * kelly_mult, tier_max, self.max_bet_pct)
        bet_size = max(bet_size, 0.0)

        return BetRecommendation(
            should_bet=bet_size > 0,
            direction=direction,
            edge=edge,
            kelly_fraction=kelly,
            bet_size_pct=bet_size,
            confidence_tier=tier,
            model_prob=model_prob,
            implied_prob=implied_prob,
            reasoning=f"{tier} confidence: {prob:.1%} prob, {edge:.1%} edge, {bet_size:.2%} of bankroll",
        )

    def _get_confidence_tier(self, prob: float, edge: float) -> tuple:
        """Determine confidence tier based on probability and edge."""
        for tier_name in ["HIGH", "MEDIUM", "LOW"]:
            config = CONFIDENCE_TIERS[tier_name]
            if prob >= config["min_prob"] and edge >= config["min_edge"]:
                return tier_name, config
        return "PASS", {}

    @staticmethod
    def _kelly_criterion(prob: float, decimal_odds: float) -> float:
        """
        Calculate Kelly criterion fraction.

        Kelly = (bp - q) / b
        where b = decimal_odds - 1, p = win prob, q = 1 - p
        """
        if decimal_odds <= 1.0 or prob <= 0 or prob >= 1:
            return 0.0
        b = decimal_odds - 1.0
        q = 1.0 - prob
        kelly = (b * prob - q) / b
        return max(kelly, 0.0)

    @staticmethod
    def _american_to_decimal(american_odds: float) -> float:
        """Convert American odds to decimal odds."""
        if american_odds > 0:
            return 1.0 + american_odds / 100.0
        elif american_odds < 0:
            return 1.0 + 100.0 / abs(american_odds)
        return 1.0
