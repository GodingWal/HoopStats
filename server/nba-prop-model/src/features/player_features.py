"""
Player Feature Engineering
Transforms raw game data into model-ready features
"""
from typing import Dict, List, Optional, Tuple
import pandas as pd
import numpy as np
from dataclasses import dataclass


@dataclass
class PlayerFeatures:
    """Container for player features"""
    player_id: int
    player_name: str
    team: str
    position: str
    
    # Volume features
    minutes_season: float
    minutes_l5: float
    minutes_l10: float
    usage_rate: float
    usage_rate_l5: float
    
    # Scoring features
    pts_per_min: float
    pts_per_min_l5: float
    ts_pct: float
    ts_pct_l5: float
    ftr: float  # Free throw rate
    
    # Rebounding features
    reb_per_min: float
    orb_pct: float
    drb_pct: float
    
    # Playmaking features
    ast_per_min: float
    ast_pct: float
    tov_rate: float
    
    # Three-point features
    three_par: float  # 3PA rate
    three_pct: float
    three_pm_per_min: float
    
    # Defensive features
    stl_per_min: float
    blk_per_min: float
    stl_pct: float
    blk_pct: float
    
    # Variance/consistency
    pts_std: float
    reb_std: float
    ast_std: float
    minutes_std: float
    
    # Career baselines (for regression)
    career_ppg: Optional[float] = None
    career_rpg: Optional[float] = None
    career_apg: Optional[float] = None
    
    # Sample size
    games_played: int = 0


class PlayerFeatureEngineer:
    """Transforms raw game logs into features"""
    
    def __init__(
        self,
        regression_games: int = 20,
        career_weight_early: float = 0.4
    ):
        """
        Args:
            regression_games: Games before trusting sample fully
            career_weight_early: Weight on career stats early in season
        """
        self.regression_games = regression_games
        self.career_weight_early = career_weight_early
        
    def engineer_features(
        self,
        game_log: pd.DataFrame,
        career_stats: Optional[pd.DataFrame] = None
    ) -> PlayerFeatures:
        """
        Engineer features from game log
        
        Args:
            game_log: Player's game log (most recent first)
            career_stats: Optional career statistics for baseline
        """
        df = self._preprocess_game_log(game_log)
        
        if len(df) == 0:
            raise ValueError("Empty game log")
        
        # Get basic info
        player_id = df['PLAYER_ID'].iloc[0] if 'PLAYER_ID' in df.columns else 0
        player_name = df['PLAYER_NAME'].iloc[0] if 'PLAYER_NAME' in df.columns else ""
        
        # Parse matchup for team
        matchup = df['MATCHUP'].iloc[0] if 'MATCHUP' in df.columns else ""
        team = matchup.split()[0] if matchup else ""
        
        # Calculate features
        features = PlayerFeatures(
            player_id=player_id,
            player_name=player_name,
            team=team,
            position=self._infer_position(df),
            
            # Volume
            minutes_season=df['MIN'].mean(),
            minutes_l5=df['MIN'].head(5).mean(),
            minutes_l10=df['MIN'].head(10).mean(),
            usage_rate=self._calculate_usage(df),
            usage_rate_l5=self._calculate_usage(df.head(5)),
            
            # Scoring
            pts_per_min=self._safe_divide(df['PTS'].sum(), df['MIN'].sum()),
            pts_per_min_l5=self._safe_divide(df['PTS'].head(5).sum(), df['MIN'].head(5).sum()),
            ts_pct=self._calculate_ts_pct(df),
            ts_pct_l5=self._calculate_ts_pct(df.head(5)),
            ftr=self._safe_divide(df['FTA'].sum(), df['FGA'].sum()),
            
            # Rebounding
            reb_per_min=self._safe_divide(df['REB'].sum(), df['MIN'].sum()),
            orb_pct=self._calculate_orb_pct(df),
            drb_pct=self._calculate_drb_pct(df),
            
            # Playmaking
            ast_per_min=self._safe_divide(df['AST'].sum(), df['MIN'].sum()),
            ast_pct=self._calculate_ast_pct(df),
            tov_rate=self._calculate_tov_rate(df),
            
            # Three-point
            three_par=self._safe_divide(df['FG3A'].sum(), df['FGA'].sum()),
            three_pct=self._safe_divide(df['FG3M'].sum(), df['FG3A'].sum()),
            three_pm_per_min=self._safe_divide(df['FG3M'].sum(), df['MIN'].sum()),
            
            # Defensive
            stl_per_min=self._safe_divide(df['STL'].sum(), df['MIN'].sum()),
            blk_per_min=self._safe_divide(df['BLK'].sum(), df['MIN'].sum()),
            stl_pct=self._estimate_stl_pct(df),
            blk_pct=self._estimate_blk_pct(df),
            
            # Variance
            pts_std=df['PTS'].std(),
            reb_std=df['REB'].std(),
            ast_std=df['AST'].std(),
            minutes_std=df['MIN'].std(),
            
            games_played=len(df)
        )
        
        # Add career baselines if available
        if career_stats is not None:
            features = self._add_career_baselines(features, career_stats)
            
        return features
    
    def get_rolling_features(
        self,
        game_log: pd.DataFrame,
        windows: List[int] = [3, 5, 10, 20]
    ) -> pd.DataFrame:
        """
        Calculate rolling features for each game
        
        Returns DataFrame with rolling stats at each point in time
        (for backtesting - uses only prior data)
        """
        df = self._preprocess_game_log(game_log)
        df = df.sort_values('GAME_DATE')
        
        stats = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'MIN', 'FGA', 'FTA']
        
        for stat in stats:
            if stat not in df.columns:
                continue
                
            for window in windows:
                # Rolling mean (shifted to avoid lookahead)
                df[f'{stat}_L{window}'] = (
                    df[stat].shift(1).rolling(window, min_periods=1).mean()
                )
                
                # Rolling std for variance modeling
                df[f'{stat}_STD_L{window}'] = (
                    df[stat].shift(1).rolling(window, min_periods=max(3, window//2)).std()
                )
        
        # Per-minute rolling
        for stat in ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M']:
            if stat not in df.columns:
                continue
            df[f'{stat}_PER_MIN_L10'] = (
                df[stat].shift(1).rolling(10, min_periods=3).sum() /
                df['MIN'].shift(1).rolling(10, min_periods=3).sum()
            )
        
        return df
    
    def calculate_trend(
        self,
        game_log: pd.DataFrame,
        stat: str,
        window: int = 5
    ) -> float:
        """
        Calculate trend (slope) for a stat over recent games
        Positive = improving, Negative = declining
        """
        df = self._preprocess_game_log(game_log)
        
        if len(df) < 3:
            return 0.0
            
        recent = df[stat].head(window).values[::-1]  # Chronological order
        x = np.arange(len(recent))
        
        if len(recent) < 2:
            return 0.0
            
        # Simple linear regression slope
        slope = np.polyfit(x, recent, 1)[0]
        
        # Normalize by mean to get % change per game
        mean = recent.mean()
        if mean > 0:
            return slope / mean
        return 0.0
    
    def regress_to_baseline(
        self,
        sample_stat: float,
        baseline_stat: float,
        games_played: int
    ) -> float:
        """
        Regress sample stat toward baseline based on sample size
        
        Uses Bayesian-style shrinkage - more games = more trust in sample
        """
        if games_played >= self.regression_games:
            return sample_stat
            
        # Weight based on games played
        sample_weight = games_played / self.regression_games
        baseline_weight = 1 - sample_weight
        
        return (sample_stat * sample_weight) + (baseline_stat * baseline_weight)
    
    # -------------------------------------------------------------------------
    # Private helper methods
    # -------------------------------------------------------------------------
    
    def _preprocess_game_log(self, df: pd.DataFrame) -> pd.DataFrame:
        """Clean and preprocess game log"""
        df = df.copy()
        
        # Parse minutes if string format (MM:SS)
        if 'MIN' in df.columns and df['MIN'].dtype == 'object':
            df['MIN'] = df['MIN'].apply(self._parse_minutes)
        
        # Ensure numeric
        numeric_cols = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'MIN', 
                       'FGM', 'FGA', 'FG3M', 'FG3A', 'FTM', 'FTA', 'OREB', 'DREB']
        for col in numeric_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        
        # Remove DNPs (0 minutes)
        df = df[df['MIN'] > 0]
        
        return df
    
    def _parse_minutes(self, min_str) -> float:
        """Parse MM:SS format to decimal minutes"""
        if pd.isna(min_str):
            return 0.0
        if isinstance(min_str, (int, float)):
            return float(min_str)
        if ':' in str(min_str):
            parts = str(min_str).split(':')
            return float(parts[0]) + float(parts[1]) / 60
        return float(min_str)
    
    def _safe_divide(self, numerator: float, denominator: float) -> float:
        """Safe division with zero handling"""
        if denominator == 0:
            return 0.0
        return numerator / denominator
    
    def _calculate_usage(self, df: pd.DataFrame) -> float:
        """Estimate usage rate from box score data"""
        # Simplified usage: (FGA + 0.44*FTA + TOV) / MIN * league_avg_pace
        fga = df['FGA'].sum()
        fta = df['FTA'].sum()
        tov = df['TOV'].sum() if 'TOV' in df.columns else 0
        minutes = df['MIN'].sum()
        
        if minutes == 0:
            return 0.0
            
        # This is a rough approximation - true USG% needs team data
        possessions_used = fga + 0.44 * fta + tov
        return (possessions_used / minutes) * 48 / 5  # Per-game estimate
    
    def _calculate_ts_pct(self, df: pd.DataFrame) -> float:
        """Calculate true shooting percentage"""
        pts = df['PTS'].sum()
        fga = df['FGA'].sum()
        fta = df['FTA'].sum()
        
        tsa = fga + 0.44 * fta
        if tsa == 0:
            return 0.0
        return pts / (2 * tsa)
    
    def _calculate_orb_pct(self, df: pd.DataFrame) -> float:
        """Estimate offensive rebound percentage"""
        if 'OREB' not in df.columns:
            return 0.0
        return self._safe_divide(df['OREB'].sum(), df['MIN'].sum()) * 48 / 5
    
    def _calculate_drb_pct(self, df: pd.DataFrame) -> float:
        """Estimate defensive rebound percentage"""
        if 'DREB' not in df.columns:
            return 0.0
        return self._safe_divide(df['DREB'].sum(), df['MIN'].sum()) * 48 / 5
    
    def _calculate_ast_pct(self, df: pd.DataFrame) -> float:
        """Estimate assist percentage"""
        ast = df['AST'].sum()
        minutes = df['MIN'].sum()
        fgm = df['FGM'].sum()
        
        if minutes == 0:
            return 0.0
        # Rough approximation
        return ast / (minutes / 48 * 40 - fgm) if (minutes / 48 * 40 - fgm) > 0 else 0
    
    def _calculate_tov_rate(self, df: pd.DataFrame) -> float:
        """Calculate turnover rate"""
        tov = df['TOV'].sum() if 'TOV' in df.columns else 0
        fga = df['FGA'].sum()
        fta = df['FTA'].sum()
        
        possessions = fga + 0.44 * fta + tov
        if possessions == 0:
            return 0.0
        return tov / possessions
    
    def _estimate_stl_pct(self, df: pd.DataFrame) -> float:
        """Estimate steal percentage"""
        return self._safe_divide(df['STL'].sum(), df['MIN'].sum()) * 48
    
    def _estimate_blk_pct(self, df: pd.DataFrame) -> float:
        """Estimate block percentage"""
        return self._safe_divide(df['BLK'].sum(), df['MIN'].sum()) * 48
    
    def _infer_position(self, df: pd.DataFrame) -> str:
        """Infer position from stats (rough heuristic)"""
        ast_per_min = self._safe_divide(df['AST'].sum(), df['MIN'].sum())
        reb_per_min = self._safe_divide(df['REB'].sum(), df['MIN'].sum())
        blk_per_min = self._safe_divide(df['BLK'].sum(), df['MIN'].sum())
        
        # Very rough heuristics
        if ast_per_min > 0.25:
            return "G"  # Guard
        elif blk_per_min > 0.08 or reb_per_min > 0.35:
            return "C"  # Center
        elif reb_per_min > 0.25:
            return "F"  # Forward
        else:
            return "G"  # Default to guard
    
    def _add_career_baselines(
        self,
        features: PlayerFeatures,
        career_stats: pd.DataFrame
    ) -> PlayerFeatures:
        """Add career baseline stats for regression"""
        try:
            # Find career totals row
            career_row = career_stats[
                career_stats['SEASON_ID'].str.contains('Career', na=False)
            ]
            
            if career_row.empty:
                return features
                
            gp = career_row['GP'].values[0]
            if gp > 0:
                features.career_ppg = career_row['PTS'].values[0] / gp
                features.career_rpg = career_row['REB'].values[0] / gp
                features.career_apg = career_row['AST'].values[0] / gp
                
        except Exception:
            pass
            
        return features


def calculate_matchup_features(
    player_features: PlayerFeatures,
    opponent_stats: Dict,
    is_home: bool = True,
    is_b2b: bool = False,
    rest_days: int = 1
) -> Dict[str, float]:
    """
    Calculate matchup-specific adjustments
    
    Args:
        player_features: Player's feature set
        opponent_stats: Opponent's defensive stats
        is_home: Home game indicator
        is_b2b: Back-to-back indicator
        rest_days: Days since last game
    """
    adjustments = {}
    
    # Baseline multipliers
    home_mult = 1.02 if is_home else 0.98
    b2b_mult = 0.95 if is_b2b else 1.0
    
    # Rest adjustment
    rest_mult = {0: 0.92, 1: 1.0, 2: 1.02, 3: 1.03}.get(min(rest_days, 3), 1.03)
    
    situational_mult = home_mult * b2b_mult * rest_mult
    
    # Points adjustment
    opp_def_rating = opponent_stats.get('def_rating', 110)  # League avg ~110
    def_factor = 110 / opp_def_rating  # >1 if bad defense, <1 if good
    adjustments['points_mult'] = situational_mult * (0.7 + 0.3 * def_factor)
    
    # Pace adjustment
    opp_pace = opponent_stats.get('pace', 100)
    pace_factor = opp_pace / 100
    adjustments['pace_mult'] = pace_factor
    
    # Rebounds adjustment
    opp_reb_allowed = opponent_stats.get('opp_reb_per_game', 44)
    reb_factor = opp_reb_allowed / 44
    adjustments['rebounds_mult'] = situational_mult * (0.8 + 0.2 * reb_factor)
    
    # Assists adjustment
    opp_ast_allowed = opponent_stats.get('opp_ast_per_game', 25)
    ast_factor = opp_ast_allowed / 25
    adjustments['assists_mult'] = situational_mult * (0.8 + 0.2 * ast_factor)
    
    # 3PT adjustment
    opp_3pt_pct_allowed = opponent_stats.get('opp_3pt_pct', 0.36)
    three_factor = opp_3pt_pct_allowed / 0.36
    adjustments['threes_mult'] = situational_mult * (0.7 + 0.3 * three_factor)
    
    # Minutes adjustment (B2B primary factor)
    adjustments['minutes_mult'] = situational_mult
    
    return adjustments
