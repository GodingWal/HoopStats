"""
NBA API Client - Wrapper for nba_api package
Fetches player stats, game logs, team data, and play-by-play
"""
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from functools import lru_cache
import time

# NBA API imports
from nba_api.stats.endpoints import (
    playergamelog,
    leaguegamefinder,
    teamgamelog,
    playercareerstats,
    leaguedashplayerstats,
    leaguedashteamstats,
    boxscoretraditionalv2,
    boxscoreadvancedv2,
    commonplayerinfo,
    scoreboardv2,
    leaguedashptdefend,
)
from nba_api.stats.static import players, teams


class NBADataClient:
    """Client for fetching NBA data from official API"""
    
    def __init__(self, request_delay: float = 0.6):
        """
        Initialize client
        
        Args:
            request_delay: Seconds between API requests (avoid rate limiting)
        """
        self.request_delay = request_delay
        self._last_request = 0
        
    def _rate_limit(self):
        """Enforce rate limiting between requests"""
        elapsed = time.time() - self._last_request
        if elapsed < self.request_delay:
            time.sleep(self.request_delay - elapsed)
        self._last_request = time.time()
        
    # -------------------------------------------------------------------------
    # Player Data
    # -------------------------------------------------------------------------
    
    def get_player_id(self, player_name: str) -> Optional[int]:
        """Get player ID from name"""
        player_list = players.find_players_by_full_name(player_name)
        if player_list:
            return player_list[0]['id']
        return None
    
    def get_all_active_players(self) -> pd.DataFrame:
        """Get all active NBA players"""
        player_list = players.get_active_players()
        return pd.DataFrame(player_list)
    
    def get_player_game_log(
        self, 
        player_id: int, 
        season: str = "2024-25",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """
        Get player's game log for a season
        
        Args:
            player_id: NBA player ID
            season: Season string (e.g., "2024-25")
            season_type: "Regular Season", "Playoffs", etc.
        """
        self._rate_limit()
        
        log = playergamelog.PlayerGameLog(
            player_id=player_id,
            season=season,
            season_type_all_star=season_type
        )
        df = log.get_data_frames()[0]
        
        # Parse game date
        df['GAME_DATE'] = pd.to_datetime(df['GAME_DATE'])
        df = df.sort_values('GAME_DATE', ascending=False)
        
        return df
    
    def get_player_career_stats(self, player_id: int) -> pd.DataFrame:
        """Get player's career stats by season"""
        self._rate_limit()
        
        career = playercareerstats.PlayerCareerStats(player_id=player_id)
        return career.get_data_frames()[0]  # Regular season totals
    
    def get_player_info(self, player_id: int) -> Dict:
        """Get player biographical info"""
        self._rate_limit()
        
        info = commonplayerinfo.CommonPlayerInfo(player_id=player_id)
        df = info.get_data_frames()[0]
        return df.iloc[0].to_dict()
    
    # -------------------------------------------------------------------------
    # League-Wide Stats
    # -------------------------------------------------------------------------
    
    def get_league_player_stats(
        self,
        season: str = "2024-25",
        per_mode: str = "PerGame",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """
        Get league-wide player stats
        
        Args:
            season: Season string
            per_mode: "PerGame", "Per36", "Per100Possessions", "Totals"
            season_type: "Regular Season", "Playoffs"
        """
        self._rate_limit()
        
        stats = leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            per_mode_detailed=per_mode,
            season_type_all_star=season_type
        )
        return stats.get_data_frames()[0]
    
    def get_league_advanced_stats(
        self,
        season: str = "2024-25",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """
        Get league-wide advanced player stats (USG%, TS%, PIE, etc.)
        """
        self._rate_limit()
        
        stats = leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            measure_type_detailed_defense='Advanced',
            season_type_all_star=season_type
        )
        return stats.get_data_frames()[0]

    def get_league_team_stats(
        self,
        season: str = "2024-25",
        per_mode: str = "PerGame",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """Get league-wide team stats"""
        self._rate_limit()
        
        stats = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            per_mode_detailed=per_mode,
            season_type_all_star=season_type
        )
        return stats.get_data_frames()[0]
    
    # -------------------------------------------------------------------------
    # Team Data
    # -------------------------------------------------------------------------
    
    def get_team_id(self, team_abbrev: str) -> Optional[int]:
        """Get team ID from abbreviation"""
        team_list = teams.find_teams_by_abbreviation(team_abbrev)
        if team_list:
            return team_list[0]['id']
        return None
    
    def get_team_game_log(
        self,
        team_id: int,
        season: str = "2024-25",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """Get team's game log"""
        self._rate_limit()
        
        log = teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star=season_type
        )
        df = log.get_data_frames()[0]
        df['GAME_DATE'] = pd.to_datetime(df['GAME_DATE'])
        return df.sort_values('GAME_DATE', ascending=False)
    
    # -------------------------------------------------------------------------
    # Box Scores
    # -------------------------------------------------------------------------
    
    def get_box_score(self, game_id: str) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """
        Get box score for a game
        
        Returns:
            Tuple of (player_stats, team_stats)
        """
        self._rate_limit()
        
        box = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id=game_id)
        dfs = box.get_data_frames()
        return dfs[0], dfs[1]  # Player stats, team stats
    
    def get_advanced_box_score(self, game_id: str) -> pd.DataFrame:
        """Get advanced box score (usage, TS%, etc.)"""
        self._rate_limit()
        
        box = boxscoreadvancedv2.BoxScoreAdvancedV2(game_id=game_id)
        return box.get_data_frames()[0]
    
    # -------------------------------------------------------------------------
    # Today's Games
    # -------------------------------------------------------------------------
    
    def get_todays_games(self) -> pd.DataFrame:
        """Get today's NBA games"""
        self._rate_limit()
        
        today = datetime.now().strftime("%Y-%m-%d")
        scoreboard = scoreboardv2.ScoreboardV2(game_date=today)
        return scoreboard.get_data_frames()[0]
    
    def get_games_on_date(self, date: str) -> pd.DataFrame:
        """Get games on specific date (YYYY-MM-DD format)"""
        self._rate_limit()
        
        scoreboard = scoreboardv2.ScoreboardV2(game_date=date)
        return scoreboard.get_data_frames()[0]
    
    # -------------------------------------------------------------------------
    # Defensive Stats
    # -------------------------------------------------------------------------
    
    def get_defensive_stats_by_position(
        self,
        season: str = "2024-25",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """Get team defensive stats by position defended"""
        self._rate_limit()
        
        defense = leaguedashptdefend.LeagueDashPtDefend(
            season=season,
            season_type_all_star=season_type,
            defense_category="Overall"
        )
        return defense.get_data_frames()[0]
    
    # -------------------------------------------------------------------------
    # Utility Methods
    # -------------------------------------------------------------------------
    
    def build_player_dataset(
        self,
        player_ids: List[int],
        season: str = "2024-25",
        include_career: bool = True
    ) -> pd.DataFrame:
        """
        Build comprehensive dataset for multiple players
        
        Args:
            player_ids: List of player IDs
            season: Season to fetch
            include_career: Whether to include career averages
        """
        all_data = []
        
        for pid in player_ids:
            try:
                # Get game log
                games = self.get_player_game_log(pid, season)
                games['PLAYER_ID'] = pid
                
                if include_career:
                    # Get career stats for baseline
                    career = self.get_player_career_stats(pid)
                    career_row = career[career['SEASON_ID'].str.contains('Career')]
                    if not career_row.empty:
                        career_ppg = career_row['PTS'].values[0] / career_row['GP'].values[0]
                        games['CAREER_PPG'] = career_ppg
                
                all_data.append(games)
                
            except Exception as e:
                print(f"Error fetching player {pid}: {e}")
                continue
        
        if all_data:
            return pd.concat(all_data, ignore_index=True)
        return pd.DataFrame()
    
    def get_season_games(
        self,
        season: str = "2024-25",
        season_type: str = "Regular Season"
    ) -> pd.DataFrame:
        """Get all games for a season"""
        self._rate_limit()
        
        games = leaguegamefinder.LeagueGameFinder(
            season_nullable=season,
            season_type_nullable=season_type
        )
        return games.get_data_frames()[0]


# Convenience functions
def get_player_rolling_stats(
    game_log: pd.DataFrame,
    windows: List[int] = [3, 5, 10, 20],
    stats: List[str] = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'MIN', 'FG3M']
) -> pd.DataFrame:
    """
    Calculate rolling averages for player stats
    
    Args:
        game_log: Player game log DataFrame
        windows: Rolling window sizes
        stats: Stats to calculate rolling averages for
    """
    df = game_log.sort_values('GAME_DATE').copy()
    
    for stat in stats:
        for window in windows:
            col_name = f"{stat}_L{window}"
            # Shift by 1 to avoid lookahead bias
            df[col_name] = df[stat].shift(1).rolling(window, min_periods=1).mean()
    
    return df


def calculate_per_minute_stats(game_log: pd.DataFrame) -> pd.DataFrame:
    """Calculate per-minute stats from game log"""
    df = game_log.copy()
    
    # Parse minutes if string format
    if df['MIN'].dtype == 'object':
        df['MIN'] = df['MIN'].apply(lambda x: float(x.split(':')[0]) + float(x.split(':')[1])/60 if ':' in str(x) else float(x))
    
    stats_to_normalize = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV', 'FG3M', 'FGA', 'FTA']
    
    for stat in stats_to_normalize:
        if stat in df.columns:
            df[f'{stat}_PER_MIN'] = df[stat] / df['MIN'].replace(0, np.nan)
    
    return df
