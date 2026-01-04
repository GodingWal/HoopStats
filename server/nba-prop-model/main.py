#!/usr/bin/env python3
"""
NBA Player Prop Model - Main Entry Point
"""
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional
import pandas as pd
import numpy as np

from src.data.nba_api_client import NBADataClient, get_player_rolling_stats
from src.features.player_features import PlayerFeatureEngineer
from src.models.projection_engine import ProjectionEngine, GameContext, create_sample_context
from src.models.distributions import DistributionModeler


def get_todays_projections(
    players: List[str],
    engine: ProjectionEngine,
    client: NBADataClient
) -> Dict:
    """
    Generate projections for specified players
    
    Args:
        players: List of player names
        engine: Projection engine instance
        client: NBA API client
    """
    projections = {}
    
    for player_name in players:
        try:
            # Get player ID
            player_id = client.get_player_id(player_name)
            if not player_id:
                print(f"Player not found: {player_name}")
                continue
            
            # Get game log
            game_log = client.get_player_game_log(player_id)
            
            if len(game_log) == 0:
                print(f"No game data for: {player_name}")
                continue
            
            # Get career stats
            career_stats = client.get_player_career_stats(player_id)
            
            # Create context (would need actual game data in production)
            context = create_sample_context()
            
            # Generate projection
            projection = engine.project_player(game_log, context, career_stats)
            projections[player_name] = projection
            
            print(f"\n{player_name} Projections:")
            print(f"  Points:   {projection.points.mean:.1f} (σ={projection.points.std:.1f})")
            print(f"  Rebounds: {projection.rebounds.mean:.1f} (σ={projection.rebounds.std:.1f})")
            print(f"  Assists:  {projection.assists.mean:.1f} (σ={projection.assists.std:.1f})")
            print(f"  3PM:      {projection.threes.mean:.1f} (σ={projection.threes.std:.1f})")
            print(f"  PRA:      {projection.pts_reb_ast.mean:.1f} (σ={projection.pts_reb_ast.std:.1f})")
            print(f"  Minutes:  {projection.minutes_mean:.1f} (σ={projection.minutes_std:.1f})")
            
        except Exception as e:
            print(f"Error projecting {player_name}: {e}")
            continue
    
    return projections


def evaluate_props(
    projections: Dict,
    lines: Dict[str, Dict[str, float]],
    engine: ProjectionEngine
) -> List:
    """
    Evaluate prop bets against projections
    
    Args:
        projections: Dict of player_name -> JointProjection
        lines: Dict of player_name -> {stat: line}
        engine: Projection engine
    """
    recommendations = []
    
    for player_name, projection in projections.items():
        if player_name not in lines:
            continue
        
        player_lines = lines[player_name]
        
        for stat, line in player_lines.items():
            try:
                rec = engine.evaluate_prop(projection, stat, line)
                if rec.edge >= engine.min_edge_threshold:
                    recommendations.append(rec)
                    print(f"\n{rec}")
            except Exception as e:
                continue
    
    # Sort by edge
    recommendations.sort(key=lambda x: x.edge, reverse=True)
    
    return recommendations


def demo():
    """Run a demo of the projection system"""
    print("=" * 60)
    print("NBA Player Prop Model - Demo")
    print("=" * 60)
    
    # Initialize components
    client = NBADataClient()
    engine = ProjectionEngine(
        min_edge_threshold=0.03,
        kelly_fraction=0.25
    )
    
    # Demo players
    demo_players = [
        "LeBron James",
        "Stephen Curry",
        "Luka Doncic",
        "Jayson Tatum",
        "Nikola Jokic"
    ]
    
    print("\nFetching player data and generating projections...")
    print("(This may take a moment due to API rate limiting)")
    
    # Get projections
    projections = get_todays_projections(demo_players, engine, client)
    
    # Demo lines (would come from odds API in production)
    demo_lines = {
        "LeBron James": {"points": 25.5, "rebounds": 7.5, "assists": 7.5},
        "Stephen Curry": {"points": 27.5, "threes": 4.5, "assists": 5.5},
        "Luka Doncic": {"points": 31.5, "assists": 8.5, "rebounds": 9.5},
        "Jayson Tatum": {"points": 28.5, "rebounds": 8.5, "assists": 4.5},
        "Nikola Jokic": {"points": 26.5, "rebounds": 12.5, "assists": 9.5},
    }
    
    print("\n" + "=" * 60)
    print("Evaluating Prop Bets (3%+ edge)")
    print("=" * 60)
    
    recommendations = evaluate_props(projections, demo_lines, engine)
    
    if not recommendations:
        print("\nNo props with sufficient edge found.")
    else:
        print(f"\nFound {len(recommendations)} props with edge >= 3%")
    
    # Demo parlay evaluation
    if projections:
        print("\n" + "=" * 60)
        print("Parlay Analysis Example")
        print("=" * 60)
        
        player_name = list(projections.keys())[0]
        projection = projections[player_name]
        
        # Example parlay: PTS over + REB over + AST over
        if player_name in demo_lines:
            lines = demo_lines[player_name]
            legs = [
                ('points', lines.get('points', 20), 'over'),
                ('rebounds', lines.get('rebounds', 5), 'over'),
                ('assists', lines.get('assists', 5), 'over'),
            ]
            
            distribution_modeler = DistributionModeler()
            result = engine.evaluate_parlay(projection, legs)
            
            print(f"\n{player_name} Parlay (all overs):")
            for stat, line, side in legs:
                print(f"  {stat} {side} {line}")
            print(f"\nParlay Probability: {result['probability']:.1%}")
            print(f"Fair Odds: {result['fair_odds']:+d}")
    
    print("\n" + "=" * 60)
    print("Demo Complete")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description='NBA Player Prop Model')
    parser.add_argument('--demo', action='store_true', help='Run demo mode')
    parser.add_argument('--players', nargs='+', help='Player names to project')
    parser.add_argument('--date', type=str, default='today', help='Date for projections')
    
    args = parser.parse_args()
    
    if args.demo:
        demo()
    elif args.players:
        client = NBADataClient()
        engine = ProjectionEngine()
        get_todays_projections(args.players, engine, client)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
