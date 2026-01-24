"""
On/Off Splits Calculator - Calculate teammate performance WITH vs WITHOUT injured player

This module calculates historical performance splits for teammates when a star player
is out. Used for prop betting to identify usage redistribution opportunities.
"""
from typing import Dict, List, Optional, Tuple
import time
import json
import sys

from nba_api.stats.endpoints import (
    playergamelog,
    teamgamelog,
    commonteamroster,
)
from nba_api.stats.static import players, teams


class OnOffSplitsCalculator:
    """Calculate performance splits for teammates when star player sits"""

    def __init__(self, request_delay: float = 0.6):
        """
        Initialize calculator

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

    def calculate_splits(
        self,
        star_player_id: str,
        team_abbr: str,
        seasons: List[str] = ["2024-25", "2023-24"]
    ) -> Dict:
        """
        Main entry point: Calculate on/off splits for all teammates

        Args:
            star_player_id: NBA player ID of injured/resting star
            team_abbr: Team abbreviation (e.g., "PHI")
            seasons: List of seasons to analyze (default: current + last season)

        Returns:
            Dictionary with star player info and teammate splits:
            {
                "star_player": {"id": int, "name": str, "team": str},
                "teammates": [
                    {
                        "player_id": int,
                        "player_name": str,
                        "season": str,
                        "games_with": int,
                        "games_without": int,
                        "pts_with": float,
                        "pts_without": float,
                        "pts_delta": float,
                        "reb_with": float,
                        "reb_without": float,
                        "reb_delta": float,
                        ...
                    }
                ]
            }
        """
        # Get team ID
        all_teams = teams.get_teams()
        team_info = next((t for t in all_teams if t['abbreviation'] == team_abbr.upper()), None)
        if not team_info:
            raise ValueError(f"Team not found: {team_abbr}")
        team_id = team_info['id']

        # Get star player name
        star_player_name = self._get_player_name(star_player_id)

        all_teammate_splits = []

        # Process each season
        for season in seasons:
            print(f"Processing season {season}...", file=sys.stderr)

            # Get games where star player was out
            missed_games, played_games = self._get_missed_games(
                team_id, star_player_id, season
            )

            if len(missed_games) < 3:
                print(f"  Skipping {season}: Only {len(missed_games)} games missed (need 3+)", file=sys.stderr)
                continue

            print(f"  Star player missed {len(missed_games)} games, played {len(played_games)}", file=sys.stderr)

            # Get team roster
            roster = self._get_team_roster(team_id, season)

            # Calculate splits for each teammate
            for teammate in roster:
                teammate_id = teammate['PLAYER_ID']
                teammate_name = teammate['PLAYER']

                # Skip the injured player
                if str(teammate_id) == str(star_player_id):
                    continue

                self._rate_limit()

                try:
                    splits = self._calculate_teammate_split(
                        teammate_id,
                        teammate_name,
                        played_games,
                        missed_games,
                        season
                    )

                    if splits:
                        all_teammate_splits.append({
                            **splits,
                            "season": season,
                            "team": team_abbr
                        })
                        print(f"    {teammate_name}: {splits['pts_delta']:+.1f} PPG delta", file=sys.stderr)

                except Exception as e:
                    print(f"    Error processing {teammate_name}: {e}", file=sys.stderr)
                    continue

        return {
            "star_player": {
                "id": int(star_player_id),
                "name": star_player_name,
                "team": team_abbr,
            },
            "teammates": all_teammate_splits
        }

    def _get_missed_games(
        self,
        team_id: str,
        player_id: str,
        season: str
    ) -> Tuple[List[str], List[str]]:
        """
        Identify games where player was OUT

        Returns:
            (missed_game_ids, played_game_ids)
        """
        self._rate_limit()

        # Get all team games
        team_log_endpoint = teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season,
            season_type_all_star="Regular Season"
        )
        team_games_df = team_log_endpoint.get_data_frames()[0]
        team_game_ids = set(team_games_df['Game_ID'].tolist())

        self._rate_limit()

        # Get player's games
        try:
            player_log_endpoint = playergamelog.PlayerGameLog(
                player_id=player_id,
                season=season,
                season_type_all_star="Regular Season"
            )
            player_games_df = player_log_endpoint.get_data_frames()[0]
            player_game_ids = set(player_games_df['Game_ID'].tolist())
        except Exception as e:
            # Player didn't play any games this season
            print(f"    Player {player_id} has no games in {season}: {e}", file=sys.stderr)
            return list(team_game_ids), []

        # Games player missed = team games - player games
        missed_games = list(team_game_ids - player_game_ids)
        played_games = list(player_game_ids)

        return missed_games, played_games

    def _calculate_teammate_split(
        self,
        teammate_id: str,
        teammate_name: str,
        games_with_star: List[str],
        games_without_star: List[str],
        season: str
    ) -> Optional[Dict]:
        """
        Calculate stats for a teammate WITH vs WITHOUT star player

        Returns:
            Dict with stats or None if insufficient data
        """
        # Get teammate's game log
        try:
            player_log_endpoint = playergamelog.PlayerGameLog(
                player_id=teammate_id,
                season=season,
                season_type_all_star="Regular Season"
            )
            df = player_log_endpoint.get_data_frames()[0]
        except Exception as e:
            return None

        if df.empty:
            return None

        # Split into games WITH and WITHOUT star
        df_with = df[df['Game_ID'].isin(games_with_star)]
        df_without = df[df['Game_ID'].isin(games_without_star)]

        # Require minimum sample size
        if len(df_without) < 2:
            return None

        # Calculate averages
        stats = {
            'player_id': int(teammate_id),
            'player_name': teammate_name,

            # Sample sizes
            'games_with': len(df_with),
            'games_without': len(df_without),

            # Stats WITH star player
            'pts_with': float(df_with['PTS'].mean()) if len(df_with) > 0 else None,
            'reb_with': float(df_with['REB'].mean()) if len(df_with) > 0 else None,
            'ast_with': float(df_with['AST'].mean()) if len(df_with) > 0 else None,
            'min_with': float(df_with['MIN'].mean()) if len(df_with) > 0 else None,
            'fga_with': float(df_with['FGA'].mean()) if len(df_with) > 0 else None,

            # Stats WITHOUT star player
            'pts_without': float(df_without['PTS'].mean()),
            'reb_without': float(df_without['REB'].mean()),
            'ast_without': float(df_without['AST'].mean()),
            'min_without': float(df_without['MIN'].mean()),
            'fga_without': float(df_without['FGA'].mean()),
        }

        # Calculate deltas
        if len(df_with) > 0:
            stats['pts_delta'] = stats['pts_without'] - stats['pts_with']
            stats['reb_delta'] = stats['reb_without'] - stats['reb_with']
            stats['ast_delta'] = stats['ast_without'] - stats['ast_with']
            stats['min_delta'] = stats['min_without'] - stats['min_with']
            stats['fga_delta'] = stats['fga_without'] - stats['fga_with']
        else:
            # No games with star (e.g., rookie season)
            stats['pts_delta'] = None
            stats['reb_delta'] = None
            stats['ast_delta'] = None
            stats['min_delta'] = None
            stats['fga_delta'] = None

        return stats

    def _get_team_roster(self, team_id: str, season: str) -> List[Dict]:
        """Get current roster for a team"""
        self._rate_limit()

        try:
            roster_endpoint = commonteamroster.CommonTeamRoster(
                team_id=team_id,
                season=season
            )
            roster_df = roster_endpoint.get_data_frames()[0]
            return roster_df.to_dict('records')
        except Exception as e:
            print(f"Error getting roster: {e}", file=sys.stderr)
            return []

    def _get_player_name(self, player_id: str) -> str:
        """Get player name from ID"""
        player_list = players.get_players()
        for player in player_list:
            if str(player['id']) == str(player_id):
                return player['full_name']
        return f"Player {player_id}"


# CLI Entry Point
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Calculate on/off splits for NBA player')
    parser.add_argument('--player-id', required=True, help='NBA player ID')
    parser.add_argument('--team', required=True, help='Team abbreviation (e.g., PHI)')
    parser.add_argument('--seasons', nargs='+', default=["2024-25", "2023-24"], help='Seasons to analyze')

    args = parser.parse_args()

    calculator = OnOffSplitsCalculator()

    try:
        result = calculator.calculate_splits(
            star_player_id=args.player_id,
            team_abbr=args.team,
            seasons=args.seasons
        )

        # Output as JSON
        print(json.dumps(result, indent=2))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
