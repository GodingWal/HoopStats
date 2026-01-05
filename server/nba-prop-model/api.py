
import argparse
import sys
import json
import pandas as pd
from typing import List, Dict

# Ensure src is in path
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from src.data.nba_api_client import NBADataClient
from src.models.projection_engine import ProjectionEngine, create_sample_context

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

def get_projections(players: List[str]):
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
                
                # Generate projection
                context = create_sample_context()
                projection = engine.project_player(game_log, context, career_stats)
                
                # Build comprehensive result
                results[player_name] = {
                    # Core projections
                    "projection": serialize_projection(projection),
                    
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
                    }
                }
                
            except Exception as e:
                results[player_name] = {"error": str(e)}
        
        return results
    except Exception as e:
        return {"error": f"Global error: {str(e)}"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--players', nargs='+', required=True, help='List of player names')
    args = parser.parse_args()
    
    # Run projections
    data = get_projections(args.players)
    
    # Print ONLY the JSON to stdout
    print(json.dumps(data))

if __name__ == "__main__":
    main()

