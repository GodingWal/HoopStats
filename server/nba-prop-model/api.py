
import argparse
import sys
import json
import pandas as pd
from typing import List, Dict, Optional
from datetime import datetime

# Ensure src is in path
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.data.nba_api_client import NBADataClient
from src.models.projection_engine import ProjectionEngine, GameContext, create_sample_context

# Cache for team stats to avoid repeated API calls
_team_stats_cache = None
_schedule_cache = {}

def get_team_stats(client: NBADataClient) -> pd.DataFrame:
    """Get cached team stats."""
    global _team_stats_cache
    if _team_stats_cache is None:
        try:
            _team_stats_cache = client.get_league_team_stats()
        except:
            _team_stats_cache = pd.DataFrame()
    return _team_stats_cache

def get_todays_schedule(client: NBADataClient) -> pd.DataFrame:
    """Get today's games schedule."""
    today = datetime.now().strftime("%Y-%m-%d")
    if today not in _schedule_cache:
        try:
            _schedule_cache[today] = client.get_todays_games()
        except:
            _schedule_cache[today] = pd.DataFrame()
    return _schedule_cache[today]

def find_player_game(client: NBADataClient, team_abbr: str) -> Optional[Dict]:
    """Find the player's team's game today."""
    schedule = get_todays_schedule(client)
    
    if schedule.empty:
        return None
    
    # Scoreboard columns: GAME_ID, HOME_TEAM_ID, VISITOR_TEAM_ID, etc.
    for _, game in schedule.iterrows():
        home_abbr = game.get('HOME_ABBREV', '') or game.get('HOME_TEAM_ABBREV', '')
        away_abbr = game.get('AWAY_ABBREV', '') or game.get('VISITOR_TEAM_ABBREV', '')
        
        if team_abbr.upper() == str(home_abbr).upper():
            return {
                "opponent": str(away_abbr),
                "is_home": True,
                "game_id": game.get('GAME_ID', '')
            }
        elif team_abbr.upper() == str(away_abbr).upper():
            return {
                "opponent": str(home_abbr),
                "is_home": False,
                "game_id": game.get('GAME_ID', '')
            }
    
    return None

def get_team_defensive_rating(client: NBADataClient, team_abbr: str) -> tuple:
    """Get a team's defensive rating and pace."""
    team_stats = get_team_stats(client)
    
    if team_stats.empty:
        return 110.0, 100.0  # Default values
    
    # Find the team
    team_row = team_stats[team_stats['TEAM_ABBREVIATION'] == team_abbr.upper()]
    
    if team_row.empty:
        return 110.0, 100.0
    
    def_rating = team_row['DEF_RATING'].values[0] if 'DEF_RATING' in team_row.columns else 110.0
    pace = team_row['PACE'].values[0] if 'PACE' in team_row.columns else 100.0
    
    return float(def_rating), float(pace)

def create_dynamic_context(client: NBADataClient, team_abbr: str, teammate_injuries: List[str] = None) -> tuple:
    """Create a real game context based on today's schedule.

    Args:
        client: NBA data client
        team_abbr: Team abbreviation (e.g., 'LAL')
        teammate_injuries: List of teammate names who are OUT

    Returns:
        Tuple of (GameContext, is_real_data)
    """
    if teammate_injuries is None:
        teammate_injuries = []

    game_info = find_player_game(client, team_abbr)

    if game_info:
        opponent = game_info['opponent']
        is_home = game_info['is_home']
        def_rating, pace = get_team_defensive_rating(client, opponent)

        context = GameContext(
            opponent=opponent,
            is_home=is_home,
            is_b2b=False,  # Would need yesterday's schedule to detect
            rest_days=1,
            spread=-3.5 if is_home else 3.5,
            total=225.5,
            opponent_def_rating=def_rating,
            opponent_pace=pace,
            teammate_injuries=teammate_injuries
        )
        return context, True  # True = real data
    else:
        # No game today, use sample context but still include injuries
        sample_ctx = create_sample_context()
        sample_ctx.teammate_injuries = teammate_injuries
        return sample_ctx, False  # False = sample data


def serialize_projection(projection):
    """Convert projection object to dictionary."""
    return {
        "points": {"mean": projection.points.mean, "std": projection.points.std},
        "rebounds": {"mean": projection.rebounds.mean, "std": projection.rebounds.std},
        "assists": {"mean": projection.assists.mean, "std": projection.assists.std},
        "threes": {"mean": projection.threes.mean, "std": projection.threes.std},
        "pts_reb_ast": {"mean": projection.pts_reb_ast.mean, "std": projection.pts_reb_ast.std},
        "minutes": {"mean": projection.minutes_mean, "std": projection.minutes_std}
    }

def calculate_averages(game_log: pd.DataFrame, n_games: int = None) -> Dict:
    """Calculate average stats from game log."""
    if n_games:
        df = game_log.head(n_games)
    else:
        df = game_log
    
    if len(df) == 0:
        return {}
    
    return {
        "games": len(df),
        "pts": round(df['PTS'].mean(), 1),
        "reb": round(df['REB'].mean(), 1),
        "ast": round(df['AST'].mean(), 1),
        "fg3m": round(df['FG3M'].mean(), 1) if 'FG3M' in df.columns else 0,
        "min": round(df['MIN'].mean(), 1) if 'MIN' in df.columns else 0,
        "stl": round(df['STL'].mean(), 1) if 'STL' in df.columns else 0,
        "blk": round(df['BLK'].mean(), 1) if 'BLK' in df.columns else 0,
        "tov": round(df['TOV'].mean(), 1) if 'TOV' in df.columns else 0,
        "fgPct": round(df['FG_PCT'].mean() * 100, 1) if 'FG_PCT' in df.columns else 0,
        "fg3Pct": round(df['FG3_PCT'].mean() * 100, 1) if 'FG3_PCT' in df.columns else 0,
    }

def format_recent_games(game_log: pd.DataFrame, n_games: int = 5) -> List[Dict]:
    """Format recent games for display."""
    games = []
    for _, row in game_log.head(n_games).iterrows():
        games.append({
            "date": row['GAME_DATE'].strftime("%b %d") if hasattr(row['GAME_DATE'], 'strftime') else str(row['GAME_DATE'])[:10],
            "opponent": row['MATCHUP'].split()[-1] if 'MATCHUP' in row else "N/A",
            "result": row.get('WL', 'N/A'),
            "pts": int(row['PTS']),
            "reb": int(row['REB']),
            "ast": int(row['AST']),
            "fg3m": int(row['FG3M']) if 'FG3M' in row else 0,
            "min": int(row['MIN']) if 'MIN' in row else 0,
        })
    return games

def get_projections(players: List[str], teammate_injuries: List[str] = None):
    """Generate projections for players.

    Args:
        players: List of player names to project
        teammate_injuries: List of injured teammate names (players who are OUT)
                          These injuries are factored into usage redistribution

    Returns:
        Dictionary of projections keyed by player name
    """
    if teammate_injuries is None:
        teammate_injuries = []

    try:
        client = NBADataClient()
        engine = ProjectionEngine()

        results = {}

        for player_name in players:
            try:
                player_id = client.get_player_id(player_name)
                if not player_id:
                    results[player_name] = {"error": "Player not found"}
                    continue

                game_log = client.get_player_game_log(player_id)
                if len(game_log) == 0:
                    results[player_name] = {"error": "No game data"}
                    continue

                # Get additional data
                career_stats = client.get_player_career_stats(player_id)

                # Try to get player info (may fail for some players)
                player_info = {}
                try:
                    info = client.get_player_info(player_id)
                    player_info = {
                        "team": info.get('TEAM_ABBREVIATION', 'N/A'),
                        "teamName": info.get('TEAM_NAME', 'N/A'),
                        "position": info.get('POSITION', 'N/A'),
                        "height": info.get('HEIGHT', 'N/A'),
                        "weight": info.get('WEIGHT', 'N/A'),
                        "age": info.get('PLAYER_AGE', 'N/A') if 'FROM_YEAR' not in info else None,
                        "jersey": info.get('JERSEY', 'N/A'),
                    }
                except:
                    pass

                # Generate projection with real opponent context if available
                # Include teammate injuries in the context
                team_abbr = player_info.get('team', '')
                if team_abbr:
                    context, is_real_context = create_dynamic_context(client, team_abbr, teammate_injuries)
                else:
                    context = create_sample_context()
                    context.teammate_injuries = teammate_injuries
                    is_real_context = False

                projection = engine.project_player(game_log, context, career_stats)

                # Build comprehensive result
                results[player_name] = {
                    # Core projections
                    "projection": serialize_projection(projection),

                    # Also include as 'distributions' for compatibility
                    "distributions": serialize_projection(projection),

                    # Player info
                    "playerInfo": player_info,

                    # Season averages
                    "seasonAverages": calculate_averages(game_log),

                    # Recent splits
                    "last5Averages": calculate_averages(game_log, 5),
                    "last10Averages": calculate_averages(game_log, 10),

                    # Recent games
                    "recentGames": format_recent_games(game_log, 5),

                    # Model context (what the model uses)
                    "modelContext": {
                        "gamesAnalyzed": len(game_log),
                        "opponent": context.opponent,
                        "isHome": context.is_home,
                        "isB2B": context.is_b2b,
                        "restDays": context.rest_days,
                        "opponentDefRating": context.opponent_def_rating,
                        "opponentPace": context.opponent_pace,
                        "isRealData": is_real_context,  # True if using real opponent data
                        "teammateInjuries": context.teammate_injuries,  # Injuries factored in
                    },

                    # Context for external use
                    "context": {
                        "opponent": context.opponent,
                        "isHome": context.is_home,
                        "teammateInjuries": context.teammate_injuries,
                    }
                }

            except Exception as e:
                results[player_name] = {"error": str(e)}

        # Wrap in projections array format for compatibility with routes.ts
        output = {
            "projections": [
                {
                    "playerName": name,
                    **data
                }
                for name, data in results.items()
                if "error" not in data
            ],
            "errors": {
                name: data["error"]
                for name, data in results.items()
                if "error" in data
            }
        }

        return output
    except Exception as e:
        return {"error": f"Global error: {str(e)}"}

def main():
    parser = argparse.ArgumentParser(description='NBA Player Projection Engine')
    parser.add_argument('--players', nargs='+', required=True,
                        help='List of player names to project')
    parser.add_argument('--injuries', nargs='*', default=[],
                        help='List of injured teammate names (players who are OUT)')
    args = parser.parse_args()

    # Run projections with injury context
    data = get_projections(args.players, args.injuries)

    # Print ONLY the JSON to stdout
    print(json.dumps(data))

if __name__ == "__main__":
    main()

