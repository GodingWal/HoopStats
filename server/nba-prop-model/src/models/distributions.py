"""
Distribution Modeling for NBA Props
Proper probability distributions for each stat type with correlation structure
"""
from typing import Dict, List, Optional, Tuple, Union
import numpy as np
import pandas as pd
from scipy import stats
from scipy.stats import norm, poisson, nbinom
from dataclasses import dataclass
from functools import lru_cache


@dataclass
class StatProjection:
    """Projection for a single stat"""
    stat_name: str
    mean: float
    std: float
    distribution: str  # "normal", "poisson", "negbinom"
    
    # Distribution parameters
    params: Dict  # e.g., {"loc": 25.5, "scale": 7.2} for normal
    
    # Derived probabilities
    percentiles: Dict[int, float] = None  # {10: x, 25: x, 50: x, 75: x, 90: x}
    
    def prob_over(self, line: float) -> float:
        """Calculate P(stat > line)"""
        if self.distribution == "normal":
            return 1 - norm.cdf(line, self.mean, self.std)
        elif self.distribution == "poisson":
            # For discrete: P(X > line) = 1 - P(X <= floor(line))
            return 1 - poisson.cdf(int(line), self.mean)
        elif self.distribution == "negbinom":
            r, p = self.params.get('r', 5), self.params.get('p', 0.5)
            return 1 - nbinom.cdf(int(line), r, p)
        else:
            # Fallback to normal
            return 1 - norm.cdf(line, self.mean, self.std)
    
    def prob_under(self, line: float) -> float:
        """Calculate P(stat < line)"""
        return 1 - self.prob_over(line)
    
    def sample(self, n: int = 10000) -> np.ndarray:
        """Generate samples from distribution"""
        if self.distribution == "normal":
            return norm.rvs(self.mean, self.std, size=n)
        elif self.distribution == "poisson":
            return poisson.rvs(self.mean, size=n)
        elif self.distribution == "negbinom":
            r, p = self.params.get('r', 5), self.params.get('p', 0.5)
            return nbinom.rvs(r, p, size=n)
        else:
            return norm.rvs(self.mean, self.std, size=n)


@dataclass
class JointProjection:
    """Joint projection for all stats with correlation structure"""
    player_name: str
    game_date: str
    opponent: str
    
    # Individual stat projections
    points: StatProjection
    rebounds: StatProjection
    assists: StatProjection
    threes: StatProjection
    steals: StatProjection
    blocks: StatProjection
    turnovers: StatProjection
    
    # Correlation matrix
    correlation_matrix: np.ndarray
    
    # Minutes projection
    minutes_mean: float
    minutes_std: float
    
    # Combination props
    pts_reb_ast: Optional[StatProjection] = None


class DistributionModeler:
    """
    Models probability distributions for player stats
    """
    
    # Default correlation structure (estimated from historical data)
    DEFAULT_CORRELATIONS = np.array([
        #  PTS   REB   AST   3PM   STL   BLK   TOV
        [1.00, 0.15, 0.35, 0.45, 0.10, 0.05, 0.30],  # Points
        [0.15, 1.00, 0.10, 0.05, 0.15, 0.30, 0.05],  # Rebounds
        [0.35, 0.10, 1.00, 0.20, 0.20, 0.05, 0.25],  # Assists
        [0.45, 0.05, 0.20, 1.00, 0.05, 0.00, 0.10],  # 3PM
        [0.10, 0.15, 0.20, 0.05, 1.00, 0.15, 0.10],  # Steals
        [0.05, 0.30, 0.05, 0.00, 0.15, 1.00, 0.05],  # Blocks
        [0.30, 0.05, 0.25, 0.10, 0.10, 0.05, 1.00],  # Turnovers
    ])
    
    STAT_NAMES = ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'turnovers']
    
    def __init__(
        self,
        n_simulations: int = 10000,
        use_empirical_correlations: bool = True
    ):
        self.n_simulations = n_simulations
        self.use_empirical_correlations = use_empirical_correlations
        
    def fit_stat_distribution(
        self,
        historical_values: np.ndarray,
        stat_type: str
    ) -> StatProjection:
        """
        Fit appropriate distribution to historical stat values
        
        Args:
            historical_values: Array of historical values for this stat
            stat_type: Type of stat (points, rebounds, etc.)
        """
        values = historical_values[~np.isnan(historical_values)]
        
        if len(values) < 3:
            # Not enough data - use wide priors
            mean = values.mean() if len(values) > 0 else 10
            std = 5.0
            return StatProjection(
                stat_name=stat_type,
                mean=mean,
                std=std,
                distribution="normal",
                params={"loc": mean, "scale": std}
            )
        
        mean = values.mean()
        std = values.std()
        
        # Choose distribution based on stat type
        if stat_type in ['points']:
            # Points are approximately normal (sum of many attempts)
            return self._fit_normal(values, stat_type)
            
        elif stat_type in ['rebounds']:
            # Rebounds: negative binomial fits well (overdispersed counts)
            return self._fit_negative_binomial(values, stat_type)
            
        elif stat_type in ['assists', 'steals', 'blocks', 'threes', 'turnovers']:
            # Count stats: Poisson or negative binomial
            # Check for overdispersion
            if std**2 > mean * 1.5:  # Significant overdispersion
                return self._fit_negative_binomial(values, stat_type)
            else:
                return self._fit_poisson(values, stat_type)
        
        else:
            return self._fit_normal(values, stat_type)
    
    def _fit_normal(self, values: np.ndarray, stat_type: str) -> StatProjection:
        """Fit normal distribution"""
        mean, std = values.mean(), values.std()
        
        # Ensure reasonable std
        std = max(std, mean * 0.15)  # At least 15% CV
        
        return StatProjection(
            stat_name=stat_type,
            mean=mean,
            std=std,
            distribution="normal",
            params={"loc": mean, "scale": std},
            percentiles={
                10: norm.ppf(0.10, mean, std),
                25: norm.ppf(0.25, mean, std),
                50: norm.ppf(0.50, mean, std),
                75: norm.ppf(0.75, mean, std),
                90: norm.ppf(0.90, mean, std),
            }
        )
    
    def _fit_poisson(self, values: np.ndarray, stat_type: str) -> StatProjection:
        """Fit Poisson distribution"""
        mean = values.mean()
        std = np.sqrt(mean)  # Poisson variance = mean
        
        return StatProjection(
            stat_name=stat_type,
            mean=mean,
            std=std,
            distribution="poisson",
            params={"mu": mean},
            percentiles={
                10: poisson.ppf(0.10, mean),
                25: poisson.ppf(0.25, mean),
                50: poisson.ppf(0.50, mean),
                75: poisson.ppf(0.75, mean),
                90: poisson.ppf(0.90, mean),
            }
        )
    
    def _fit_negative_binomial(self, values: np.ndarray, stat_type: str) -> StatProjection:
        """Fit negative binomial distribution"""
        mean = values.mean()
        var = values.var()
        
        # Method of moments for negative binomial
        # Mean = r(1-p)/p, Var = r(1-p)/p^2
        if var <= mean:
            # No overdispersion, fall back to Poisson
            return self._fit_poisson(values, stat_type)
        
        p = mean / var
        r = mean * p / (1 - p)
        
        # Ensure valid parameters
        r = max(r, 0.5)
        p = min(max(p, 0.01), 0.99)
        
        std = np.sqrt(var)
        
        return StatProjection(
            stat_name=stat_type,
            mean=mean,
            std=std,
            distribution="negbinom",
            params={"r": r, "p": p},
            percentiles={
                10: nbinom.ppf(0.10, r, p),
                25: nbinom.ppf(0.25, r, p),
                50: nbinom.ppf(0.50, r, p),
                75: nbinom.ppf(0.75, r, p),
                90: nbinom.ppf(0.90, r, p),
            }
        )
    
    def create_joint_projection(
        self,
        stat_projections: Dict[str, StatProjection],
        player_name: str,
        game_date: str,
        opponent: str,
        minutes_mean: float,
        minutes_std: float,
        correlation_matrix: Optional[np.ndarray] = None
    ) -> JointProjection:
        """
        Create joint projection with correlation structure
        """
        if correlation_matrix is None:
            correlation_matrix = self.DEFAULT_CORRELATIONS
            
        # Create PRA projection
        pts_proj = stat_projections.get('points')
        reb_proj = stat_projections.get('rebounds')
        ast_proj = stat_projections.get('assists')
        
        if pts_proj and reb_proj and ast_proj:
            pra_mean = pts_proj.mean + reb_proj.mean + ast_proj.mean
            # Variance of sum with correlations
            # Var(X+Y+Z) = Var(X) + Var(Y) + Var(Z) + 2*Cov(X,Y) + 2*Cov(X,Z) + 2*Cov(Y,Z)
            pra_var = (
                pts_proj.std**2 + reb_proj.std**2 + ast_proj.std**2 +
                2 * correlation_matrix[0, 1] * pts_proj.std * reb_proj.std +  # pts-reb
                2 * correlation_matrix[0, 2] * pts_proj.std * ast_proj.std +  # pts-ast
                2 * correlation_matrix[1, 2] * reb_proj.std * ast_proj.std    # reb-ast
            )
            pra_std = np.sqrt(max(pra_var, 1))
            
            pra_projection = StatProjection(
                stat_name="pts_reb_ast",
                mean=pra_mean,
                std=pra_std,
                distribution="normal",  # Sum tends to normal
                params={"loc": pra_mean, "scale": pra_std}
            )
        else:
            pra_projection = None
        
        return JointProjection(
            player_name=player_name,
            game_date=game_date,
            opponent=opponent,
            points=stat_projections.get('points'),
            rebounds=stat_projections.get('rebounds'),
            assists=stat_projections.get('assists'),
            threes=stat_projections.get('threes'),
            steals=stat_projections.get('steals'),
            blocks=stat_projections.get('blocks'),
            turnovers=stat_projections.get('turnovers'),
            correlation_matrix=correlation_matrix,
            minutes_mean=minutes_mean,
            minutes_std=minutes_std,
            pts_reb_ast=pra_projection
        )
    
    def simulate_joint_outcomes(
        self,
        projection: JointProjection,
        n_sims: Optional[int] = None
    ) -> pd.DataFrame:
        """
        Monte Carlo simulation of joint outcomes using Gaussian copula
        
        Returns DataFrame with simulated stat lines
        """
        n = n_sims or self.n_simulations
        
        # Generate correlated uniform random variables via Gaussian copula
        normal_samples = np.random.multivariate_normal(
            mean=np.zeros(7),
            cov=projection.correlation_matrix,
            size=n
        )
        
        # Transform to uniform via normal CDF
        uniform_samples = norm.cdf(normal_samples)
        
        # Transform to each marginal distribution
        results = {}
        
        stat_projections = [
            projection.points,
            projection.rebounds,
            projection.assists,
            projection.threes,
            projection.steals,
            projection.blocks,
            projection.turnovers
        ]
        
        for i, (stat_name, proj) in enumerate(zip(self.STAT_NAMES, stat_projections)):
            if proj is None:
                results[stat_name] = np.zeros(n)
                continue
                
            if proj.distribution == "normal":
                results[stat_name] = norm.ppf(uniform_samples[:, i], proj.mean, proj.std)
            elif proj.distribution == "poisson":
                results[stat_name] = poisson.ppf(uniform_samples[:, i], proj.mean)
            elif proj.distribution == "negbinom":
                r, p = proj.params.get('r', 5), proj.params.get('p', 0.5)
                results[stat_name] = nbinom.ppf(uniform_samples[:, i], r, p)
        
        # Calculate combo stats
        results['pts_reb_ast'] = results['points'] + results['rebounds'] + results['assists']
        results['pts_reb'] = results['points'] + results['rebounds']
        results['pts_ast'] = results['points'] + results['assists']
        results['reb_ast'] = results['rebounds'] + results['assists']
        
        return pd.DataFrame(results)
    
    def calculate_combo_probability(
        self,
        projection: JointProjection,
        lines: Dict[str, float],
        all_overs: bool = True
    ) -> float:
        """
        Calculate probability of hitting multiple props
        
        Args:
            projection: Joint projection
            lines: Dict of stat_name -> line
            all_overs: True for all overs, False for all unders
        """
        sims = self.simulate_joint_outcomes(projection)
        
        hits = np.ones(len(sims), dtype=bool)
        
        for stat, line in lines.items():
            if stat in sims.columns:
                if all_overs:
                    hits &= (sims[stat] > line)
                else:
                    hits &= (sims[stat] < line)
        
        return hits.mean()
    
    def estimate_correlation_from_data(
        self,
        game_logs: pd.DataFrame
    ) -> np.ndarray:
        """
        Estimate correlation matrix from historical game logs
        """
        stat_cols = ['PTS', 'REB', 'AST', 'FG3M', 'STL', 'BLK', 'TOV']
        
        available_cols = [c for c in stat_cols if c in game_logs.columns]
        
        if len(available_cols) < 2:
            return self.DEFAULT_CORRELATIONS
        
        # Calculate correlation matrix
        corr_matrix = game_logs[available_cols].corr().values
        
        # Ensure positive semi-definite
        eigvals = np.linalg.eigvalsh(corr_matrix)
        if np.min(eigvals) < 0:
            # Fix by adding small value to diagonal
            corr_matrix += np.eye(len(corr_matrix)) * (abs(np.min(eigvals)) + 0.01)
            # Re-normalize to correlations
            d = np.sqrt(np.diag(corr_matrix))
            corr_matrix = corr_matrix / np.outer(d, d)
        
        return corr_matrix


def calculate_edge(
    model_prob: float,
    line_odds: int
) -> Tuple[float, float]:
    """
    Calculate betting edge
    
    Args:
        model_prob: Model's probability of winning
        line_odds: American odds (e.g., -110, +120)
    
    Returns:
        Tuple of (edge, expected_value)
    """
    # Convert American odds to implied probability
    if line_odds < 0:
        implied_prob = abs(line_odds) / (abs(line_odds) + 100)
    else:
        implied_prob = 100 / (line_odds + 100)
    
    # Edge is the difference between model prob and implied prob
    edge = model_prob - implied_prob
    
    # Calculate EV per dollar bet
    if line_odds < 0:
        profit_if_win = 100 / abs(line_odds)
    else:
        profit_if_win = line_odds / 100
    
    ev = model_prob * profit_if_win - (1 - model_prob) * 1
    
    return edge, ev


def kelly_criterion(
    edge: float,
    odds: int,
    fraction: float = 0.25
) -> float:
    """
    Calculate Kelly bet size
    
    Args:
        edge: Model edge (prob - implied_prob)
        odds: American odds
        fraction: Fraction of Kelly to use (0.25 = quarter Kelly)
    
    Returns:
        Recommended bet as fraction of bankroll
    """
    if edge <= 0:
        return 0.0
    
    # Convert odds to decimal
    if odds < 0:
        decimal_odds = 1 + 100 / abs(odds)
    else:
        decimal_odds = 1 + odds / 100
    
    # Kelly formula: f = (bp - q) / b where b = odds-1, p = prob, q = 1-p
    b = decimal_odds - 1
    
    # Back-calculate probability from edge + implied
    if odds < 0:
        implied = abs(odds) / (abs(odds) + 100)
    else:
        implied = 100 / (odds + 100)
    
    p = implied + edge
    q = 1 - p
    
    kelly = (b * p - q) / b
    
    # Apply fraction and cap
    bet_size = max(0, kelly * fraction)
    bet_size = min(bet_size, 0.05)  # Cap at 5% of bankroll
    
    return bet_size
