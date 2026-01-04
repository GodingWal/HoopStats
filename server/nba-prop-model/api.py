
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

def get_projections(players: List[str]):
    try:
        client = NBADataClient()
        engine = ProjectionEngine()
        
        results = {}
        
        for player_name in players:
            try:
                # Redirect stdout to suppress logs from libraries
                # sys.stdout = sys.stderr 
                # (Commented out to avoid interfering with json output if not managed carefully, 
                # instead we just won't print anything else)
                
                player_id = client.get_player_id(player_name)
                if not player_id:
                    results[player_name] = {"error": "Player not found"}
                    continue
                
                game_log = client.get_player_game_log(player_id)
                if len(game_log) == 0:
                    results[player_name] = {"error": "No game data"}
                    continue
                    
                career_stats = client.get_player_career_stats(player_id)
                context = create_sample_context()
                
                projection = engine.project_player(game_log, context, career_stats)
                results[player_name] = serialize_projection(projection)
                
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
