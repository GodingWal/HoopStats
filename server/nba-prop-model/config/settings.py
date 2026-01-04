"""
Configuration settings for NBA Prop Model
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import os

@dataclass
class APIConfig:
    """API configuration"""
    odds_api_key: str = os.getenv("ODDS_API_KEY", "")
    odds_api_base: str = "https://api.the-odds-api.com/v4"
    
@dataclass
class ModelConfig:
    """Model hyperparameters"""
    # Minutes model
    minutes_season_weight: float = 0.5
    minutes_recent_weight: float = 0.3
    minutes_b2b_penalty: float = 0.92  # Multiply by this for B2B
    minutes_blowout_threshold: float = 12.0  # Spread threshold
    
    # Regression parameters
    regression_to_mean_games: int = 20  # Games before trusting sample
    career_weight_early_season: float = 0.4
    
    # Distribution parameters
    points_dist: str = "normal"
    rebounds_dist: str = "negbinom"
    assists_dist: str = "poisson"
    threes_dist: str = "poisson"
    steals_dist: str = "poisson"
    blocks_dist: str = "poisson"
    
    # Simulation
    n_simulations: int = 10000
    
    # Betting
    min_edge_threshold: float = 0.03  # 3% edge minimum
    kelly_fraction: float = 0.25  # Quarter Kelly
    max_bet_pct: float = 0.02  # Max 2% of bankroll per bet

@dataclass
class FeatureConfig:
    """Feature engineering settings"""
    rolling_windows: List[int] = field(default_factory=lambda: [3, 5, 10, 20])
    
    # Matchup adjustment weights
    opp_def_weight: float = 0.7
    position_matchup_weight: float = 0.2
    historical_matchup_weight: float = 0.1
    
    # Situational factors
    home_advantage_pts: float = 2.5
    b2b_minutes_reduction: float = 0.08  # 8% reduction
    rest_days_boost: Dict[int, float] = field(default_factory=lambda: {
        0: 0.92,   # B2B
        1: 1.00,   # Normal rest
        2: 1.02,   # 2 days
        3: 1.03,   # 3+ days
    })

@dataclass  
class DatabaseConfig:
    """Database settings"""
    db_path: str = "data/nba_props.db"
    
# Stat type configurations
STAT_CONFIGS = {
    "points": {
        "distribution": "normal",
        "per_minute_baseline": True,
        "key_features": ["usage_rate", "ts_pct", "ftr", "opp_def_rating"],
        "volatility": "medium",
    },
    "rebounds": {
        "distribution": "negbinom",
        "per_minute_baseline": True,
        "key_features": ["orb_pct", "drb_pct", "opp_reb_allowed", "pace"],
        "volatility": "medium",
    },
    "assists": {
        "distribution": "poisson",
        "per_minute_baseline": True,
        "key_features": ["ast_pct", "usage_rate", "teammate_scoring", "opp_ast_allowed"],
        "volatility": "high",
    },
    "threes": {
        "distribution": "poisson",
        "per_minute_baseline": True,
        "key_features": ["3par", "3pt_pct", "opp_3pt_def"],
        "volatility": "very_high",
    },
    "steals": {
        "distribution": "poisson",
        "per_minute_baseline": True,
        "key_features": ["stl_pct", "opp_tov_rate"],
        "volatility": "very_high",
    },
    "blocks": {
        "distribution": "poisson",
        "per_minute_baseline": True,
        "key_features": ["blk_pct", "opp_rim_attempts"],
        "volatility": "very_high",
    },
    "turnovers": {
        "distribution": "poisson",
        "per_minute_baseline": True,
        "key_features": ["tov_rate", "usage_rate", "opp_stl_rate"],
        "volatility": "high",
    },
    "pts_reb_ast": {
        "distribution": "normal",  # Sum tends toward normal
        "combination": ["points", "rebounds", "assists"],
        "volatility": "low",  # Diversification reduces variance
    },
}

# Position mappings
POSITIONS = {
    1: "PG",
    2: "SG", 
    3: "SF",
    4: "PF",
    5: "C",
}

# Team abbreviations
TEAMS = [
    "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN",
    "DET", "GSW", "HOU", "IND", "LAC", "LAL", "MEM", "MIA",
    "MIL", "MIN", "NOP", "NYK", "OKC", "ORL", "PHI", "PHX",
    "POR", "SAC", "SAS", "TOR", "UTA", "WAS"
]
