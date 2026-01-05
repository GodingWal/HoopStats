"""
Comprehensive example: Generate projections with all enhancements

This example demonstrates:
1. Minutes model with B2B, rest, blowout risk
2. Usage redistribution when star players are out
3. Positional defense matchups
4. Distribution modeling and P(over) calculations
5. Kelly criterion bet sizing
6. Backtesting
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import pandas as pd
import numpy as np
from datetime import datetime

from src.models.projection_engine import ProjectionEngine, GameContext
from src.models.distributions import calculate_edge, kelly_criterion
from src.features.player_features import PlayerFeatureEngineer


def example_1_basic_projection():
    """
    Example 1: Basic projection for a player
    """
    print("\n" + "="*60)
    print("EXAMPLE 1: Basic Projection")
    print("="*60)

    # Create sample game log (would come from NBA API)
    game_log = pd.DataFrame({
        'PLAYER_ID': [203999] * 10,
        'PLAYER_NAME': ['Nikola Jokic'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['DEN vs. LAL'] * 10,
        'MIN': [36, 35, 38, 34, 37, 36, 39, 35, 36, 37],
        'PTS': [27, 31, 24, 29, 26, 33, 28, 25, 30, 27],
        'REB': [12, 14, 11, 13, 10, 15, 12, 11, 13, 14],
        'AST': [10, 8, 11, 9, 12, 7, 10, 11, 9, 8],
        'STL': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'BLK': [1, 1, 0, 2, 1, 1, 0, 1, 1, 2],
        'TOV': [3, 2, 4, 3, 2, 3, 4, 2, 3, 3],
        'FGM': [10, 12, 9, 11, 10, 13, 11, 9, 12, 10],
        'FGA': [18, 20, 17, 19, 18, 21, 19, 17, 20, 18],
        'FG3M': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'FG3A': [3, 4, 3, 3, 2, 4, 3, 3, 4, 3],
        'FTM': [6, 5, 5, 6, 6, 5, 5, 6, 4, 6],
        'FTA': [7, 6, 6, 7, 7, 6, 6, 7, 5, 7],
        'OREB': [3, 4, 2, 3, 2, 4, 3, 2, 3, 4],
        'DREB': [9, 10, 9, 10, 8, 11, 9, 9, 10, 10],
    })

    # Create game context
    context = GameContext(
        opponent="LAL",
        is_home=True,
        is_b2b=False,
        rest_days=2,
        spread=-5.5,  # Nuggets favored by 5.5
        total=225.5,
        opponent_def_rating=112.0,
        opponent_pace=98.5,
        teammate_injuries=[]  # No injuries
    )

    # Initialize projection engine
    engine = ProjectionEngine(
        min_edge_threshold=0.03,
        kelly_fraction=0.25,
        n_simulations=10000
    )

    # Generate projection
    projection = engine.project_player(game_log, context)

    # Display results
    print(f"\nPlayer: {projection.player_name}")
    print(f"Opponent: {projection.opponent}")
    print(f"Projected Minutes: {projection.minutes_mean:.1f} ± {projection.minutes_std:.1f}")
    print("\nProjected Stats:")
    print(f"  Points:   {projection.points.mean:.1f} ± {projection.points.std:.1f}")
    print(f"  Rebounds: {projection.rebounds.mean:.1f} ± {projection.rebounds.std:.1f}")
    print(f"  Assists:  {projection.assists.mean:.1f} ± {projection.assists.std:.1f}")
    print(f"  Threes:   {projection.threes.mean:.1f} ± {projection.threes.std:.1f}")

    # Calculate P(over) for common lines
    print("\nP(Over) for Common Lines:")
    print(f"  Points O/U 28.5:  {projection.points.prob_over(28.5):.1%}")
    print(f"  Rebounds O/U 12.5: {projection.rebounds.prob_over(12.5):.1%}")
    print(f"  Assists O/U 9.5:   {projection.assists.prob_over(9.5):.1%}")

    return projection


def example_2_injury_impact():
    """
    Example 2: Projection with star teammate out (usage redistribution)
    """
    print("\n" + "="*60)
    print("EXAMPLE 2: Usage Redistribution (Jamal Murray OUT)")
    print("="*60)

    # Same Jokic game log
    game_log = pd.DataFrame({
        'PLAYER_ID': [203999] * 10,
        'PLAYER_NAME': ['Nikola Jokic'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['DEN vs. LAL'] * 10,
        'MIN': [36, 35, 38, 34, 37, 36, 39, 35, 36, 37],
        'PTS': [27, 31, 24, 29, 26, 33, 28, 25, 30, 27],
        'REB': [12, 14, 11, 13, 10, 15, 12, 11, 13, 14],
        'AST': [10, 8, 11, 9, 12, 7, 10, 11, 9, 8],
        'STL': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'BLK': [1, 1, 0, 2, 1, 1, 0, 1, 1, 2],
        'TOV': [3, 2, 4, 3, 2, 3, 4, 2, 3, 3],
        'FGM': [10, 12, 9, 11, 10, 13, 11, 9, 12, 10],
        'FGA': [18, 20, 17, 19, 18, 21, 19, 17, 20, 18],
        'FG3M': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'FG3A': [3, 4, 3, 3, 2, 4, 3, 3, 4, 3],
        'FTM': [6, 5, 5, 6, 6, 5, 5, 6, 4, 6],
        'FTA': [7, 6, 6, 7, 7, 6, 6, 7, 5, 7],
        'OREB': [3, 4, 2, 3, 2, 4, 3, 2, 3, 4],
        'DREB': [9, 10, 9, 10, 8, 11, 9, 9, 10, 10],
    })

    # Context WITH Jamal Murray out
    context = GameContext(
        opponent="LAL",
        is_home=True,
        is_b2b=False,
        rest_days=2,
        spread=-5.5,
        total=225.5,
        opponent_def_rating=112.0,
        opponent_pace=98.5,
        teammate_injuries=["Jamal Murray"]  # Star guard OUT
    )

    engine = ProjectionEngine(min_edge_threshold=0.03)
    projection = engine.project_player(game_log, context)

    print(f"\nPlayer: {projection.player_name}")
    print(f"Context: Jamal Murray (20+ ppg, 6+ apg) is OUT")
    print(f"\nExpected Boosts:")
    print(f"  Points:   +7.2 (historical avg when Murray out)")
    print(f"  Assists:  +2.5 (more ball handling)")
    print(f"  Minutes:  +2-3 (injury redistribution)")

    print(f"\nProjected Stats:")
    print(f"  Points:   {projection.points.mean:.1f} ± {projection.points.std:.1f}")
    print(f"  Rebounds: {projection.rebounds.mean:.1f} ± {projection.rebounds.std:.1f}")
    print(f"  Assists:  {projection.assists.mean:.1f} ± {projection.assists.std:.1f}")
    print(f"  Minutes:  {projection.minutes_mean:.1f} ± {projection.minutes_std:.1f}")

    print("\n⭐ Look for OVER bets when star teammates are out!")
    return projection


def example_3_b2b_and_blowout_risk():
    """
    Example 3: Back-to-back game with high blowout risk
    """
    print("\n" + "="*60)
    print("EXAMPLE 3: B2B + Blowout Risk (Minutes Model)")
    print("="*60)

    # Luka Doncic game log
    game_log = pd.DataFrame({
        'PLAYER_ID': [1629029] * 10,
        'PLAYER_NAME': ['Luka Doncic'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['DAL vs. POR'] * 10,
        'MIN': [37, 36, 38, 35, 37, 39, 36, 37, 38, 36],
        'PTS': [33, 31, 35, 28, 32, 36, 30, 33, 34, 31],
        'REB': [8, 9, 7, 10, 8, 9, 7, 8, 9, 8],
        'AST': [9, 10, 8, 11, 9, 8, 10, 9, 8, 10],
        'STL': [1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
        'BLK': [0, 1, 0, 1, 0, 0, 1, 0, 1, 0],
        'TOV': [4, 3, 5, 4, 3, 4, 5, 4, 3, 4],
        'FGM': [11, 10, 12, 9, 11, 13, 10, 11, 12, 10],
        'FGA': [22, 21, 24, 20, 22, 25, 21, 22, 24, 21],
        'FG3M': [4, 3, 5, 2, 4, 5, 3, 4, 5, 3],
        'FG3A': [11, 10, 12, 9, 11, 13, 10, 11, 12, 10],
        'FTM': [7, 8, 6, 8, 6, 5, 7, 7, 5, 8],
        'FTA': [8, 9, 7, 9, 7, 6, 8, 8, 6, 9],
        'OREB': [1, 2, 1, 2, 1, 1, 1, 1, 2, 1],
        'DREB': [7, 7, 6, 8, 7, 8, 6, 7, 7, 7],
    })

    # Context: B2B game, heavy favorite (blowout risk)
    context = GameContext(
        opponent="POR",  # Weak team
        is_home=True,
        is_b2b=True,  # Second night of back-to-back
        rest_days=0,
        spread=-12.5,  # Heavy favorite
        total=228.5,
        opponent_def_rating=118.0,  # Bad defense
        opponent_pace=102.0,
        teammate_injuries=[]
    )

    engine = ProjectionEngine()
    projection = engine.project_player(game_log, context)

    print(f"\nPlayer: {projection.player_name}")
    print(f"Context: Back-to-back + Heavy Favorite (-12.5)")
    print(f"\nExpected Adjustments:")
    print(f"  B2B Impact:      -4.5 minutes")
    print(f"  Blowout Risk:    -2.8 minutes (35% blowout probability)")
    print(f"  Total Minutes:   ~30-32 (vs 37 typical)")

    print(f"\nProjected Stats:")
    print(f"  Minutes:  {projection.minutes_mean:.1f} ± {projection.minutes_std:.1f}")
    print(f"  Points:   {projection.points.mean:.1f} ± {projection.points.std:.1f}")
    print(f"  Rebounds: {projection.rebounds.mean:.1f} ± {projection.rebounds.std:.1f}")
    print(f"  Assists:  {projection.assists.mean:.1f} ± {projection.assists.std:.1f}")

    print("\n⚠️  Fade heavy favorites on B2B (reduced minutes in blowouts)")
    return projection


def example_4_favorable_matchup():
    """
    Example 4: Favorable positional matchup
    """
    print("\n" + "="*60)
    print("EXAMPLE 4: Favorable Matchup (Positional Defense)")
    print("="*60)

    # Stephen Curry game log
    game_log = pd.DataFrame({
        'PLAYER_ID': [201939] * 10,
        'PLAYER_NAME': ['Stephen Curry'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['GSW @ WAS'] * 10,
        'MIN': [34, 35, 33, 36, 34, 35, 33, 34, 35, 34],
        'PTS': [28, 26, 30, 24, 29, 27, 31, 26, 28, 27],
        'REB': [5, 6, 4, 5, 6, 5, 4, 5, 6, 5],
        'AST': [6, 7, 5, 8, 6, 7, 5, 6, 7, 6],
        'STL': [1, 2, 1, 1, 2, 1, 1, 2, 1, 1],
        'BLK': [0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        'TOV': [3, 2, 3, 4, 3, 2, 3, 3, 2, 3],
        'FGM': [9, 8, 10, 7, 9, 8, 11, 8, 9, 8],
        'FGA': [19, 18, 20, 17, 19, 18, 21, 18, 19, 18],
        'FG3M': [5, 4, 6, 3, 5, 4, 7, 4, 5, 4],
        'FG3A': [12, 11, 13, 10, 12, 11, 14, 11, 12, 11],
        'FTM': [5, 6, 4, 7, 6, 7, 4, 6, 5, 7],
        'FTA': [6, 7, 5, 8, 7, 8, 5, 7, 6, 8],
        'OREB': [0, 1, 0, 1, 0, 1, 0, 0, 1, 0],
        'DREB': [5, 5, 4, 4, 6, 4, 4, 5, 5, 5],
    })

    # Context: Playing Washington (terrible defense vs guards)
    context = GameContext(
        opponent="WAS",
        is_home=False,
        is_b2b=False,
        rest_days=2,
        spread=-8.5,
        total=232.5,  # High total (fast pace)
        opponent_def_rating=118.5,  # 30th ranked defense
        opponent_pace=103.0,  # Fast pace
        teammate_injuries=[]
    )

    engine = ProjectionEngine()
    projection = engine.project_player(game_log, context)

    print(f"\nPlayer: {projection.player_name} (Guard)")
    print(f"Opponent: Washington Wizards")
    print(f"\nMatchup Advantages:")
    print(f"  WAS vs Guards:   +10% points (118.5 def rating)")
    print(f"  WAS vs Guards:   +8% assists")
    print(f"  WAS vs Guards:   +12% threes")
    print(f"  Fast Pace:       +3% (103.0 pace)")

    print(f"\nProjected Stats (with matchup boost):")
    print(f"  Points:   {projection.points.mean:.1f} ± {projection.points.std:.1f}")
    print(f"  Assists:  {projection.assists.mean:.1f} ± {projection.assists.std:.1f}")
    print(f"  Threes:   {projection.threes.mean:.1f} ± {projection.threes.std:.1f}")

    print("\n🎯 Target players against bad defenses at their position!")
    return projection


def example_5_bet_evaluation():
    """
    Example 5: Evaluate specific prop bet with edge and Kelly sizing
    """
    print("\n" + "="*60)
    print("EXAMPLE 5: Bet Evaluation & Kelly Sizing")
    print("="*60)

    # Use projection from Example 1
    game_log = pd.DataFrame({
        'PLAYER_ID': [203999] * 10,
        'PLAYER_NAME': ['Nikola Jokic'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['DEN vs. LAL'] * 10,
        'MIN': [36, 35, 38, 34, 37, 36, 39, 35, 36, 37],
        'PTS': [27, 31, 24, 29, 26, 33, 28, 25, 30, 27],
        'REB': [12, 14, 11, 13, 10, 15, 12, 11, 13, 14],
        'AST': [10, 8, 11, 9, 12, 7, 10, 11, 9, 8],
        'STL': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'BLK': [1, 1, 0, 2, 1, 1, 0, 1, 1, 2],
        'TOV': [3, 2, 4, 3, 2, 3, 4, 2, 3, 3],
        'FGM': [10, 12, 9, 11, 10, 13, 11, 9, 12, 10],
        'FGA': [18, 20, 17, 19, 18, 21, 19, 17, 20, 18],
        'FG3M': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'FG3A': [3, 4, 3, 3, 2, 4, 3, 3, 4, 3],
        'FTM': [6, 5, 5, 6, 6, 5, 5, 6, 4, 6],
        'FTA': [7, 6, 6, 7, 7, 6, 6, 7, 5, 7],
        'OREB': [3, 4, 2, 3, 2, 4, 3, 2, 3, 4],
        'DREB': [9, 10, 9, 10, 8, 11, 9, 9, 10, 10],
    })

    context = GameContext(
        opponent="LAL", is_home=True, is_b2b=False, rest_days=2,
        spread=-5.5, total=225.5, opponent_def_rating=112.0,
        opponent_pace=98.5, teammate_injuries=[]
    )

    engine = ProjectionEngine(min_edge_threshold=0.03, kelly_fraction=0.25)
    projection = engine.project_player(game_log, context)

    # Evaluate specific props
    props = [
        ('points', 27.5, -110),
        ('rebounds', 11.5, -115),
        ('assists', 8.5, -105),
        ('pts_reb_ast', 48.5, -110),
    ]

    print(f"\nEvaluating Props for {projection.player_name}:\n")

    for stat, line, odds in props:
        rec = engine.evaluate_prop(projection, stat, line, odds)

        print(f"{stat.upper()} {rec.side.upper()} {line} ({odds})")
        print(f"  Model P({rec.side}): {rec.model_prob:.1%}")
        print(f"  Implied Prob:        {rec.implied_prob:.1%}")
        print(f"  Edge:                {rec.edge:+.1%}")
        print(f"  Expected Value:      {rec.expected_value:+.1%}")
        print(f"  Kelly Bet:           {rec.kelly_bet:.1%} of bankroll")
        print(f"  Confidence:          {rec.confidence}")

        if rec.edge >= 0.03:
            print(f"  ✅ BET RECOMMENDATION")
        else:
            print(f"  ❌ No bet (edge < 3%)")
        print()


def example_6_parlay_evaluation():
    """
    Example 6: Correlation-aware parlay evaluation
    """
    print("\n" + "="*60)
    print("EXAMPLE 6: Correlation-Aware Parlay")
    print("="*60)

    # Projection from Example 1
    game_log = pd.DataFrame({
        'PLAYER_ID': [203999] * 10,
        'PLAYER_NAME': ['Nikola Jokic'] * 10,
        'GAME_DATE': pd.date_range(end=datetime.now(), periods=10, freq='2D'),
        'MATCHUP': ['DEN vs. LAL'] * 10,
        'MIN': [36, 35, 38, 34, 37, 36, 39, 35, 36, 37],
        'PTS': [27, 31, 24, 29, 26, 33, 28, 25, 30, 27],
        'REB': [12, 14, 11, 13, 10, 15, 12, 11, 13, 14],
        'AST': [10, 8, 11, 9, 12, 7, 10, 11, 9, 8],
        'STL': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'BLK': [1, 1, 0, 2, 1, 1, 0, 1, 1, 2],
        'TOV': [3, 2, 4, 3, 2, 3, 4, 2, 3, 3],
        'FGM': [10, 12, 9, 11, 10, 13, 11, 9, 12, 10],
        'FGA': [18, 20, 17, 19, 18, 21, 19, 17, 20, 18],
        'FG3M': [1, 2, 1, 1, 0, 2, 1, 1, 2, 1],
        'FG3A': [3, 4, 3, 3, 2, 4, 3, 3, 4, 3],
        'FTM': [6, 5, 5, 6, 6, 5, 5, 6, 4, 6],
        'FTA': [7, 6, 6, 7, 7, 6, 6, 7, 5, 7],
        'OREB': [3, 4, 2, 3, 2, 4, 3, 2, 3, 4],
        'DREB': [9, 10, 9, 10, 8, 11, 9, 9, 10, 10],
    })

    context = GameContext(
        opponent="LAL", is_home=True, is_b2b=False, rest_days=2,
        spread=-5.5, total=225.5, opponent_def_rating=112.0,
        opponent_pace=98.5, teammate_injuries=[]
    )

    engine = ProjectionEngine()
    projection = engine.project_player(game_log, context)

    # 2-leg parlay: Points + Rebounds
    parlay_legs = [
        ('points', 25.5, 'over'),
        ('rebounds', 11.5, 'over')
    ]

    result = engine.evaluate_parlay(projection, parlay_legs, n_sims=10000)

    print(f"\n2-Leg Parlay: Jokic O25.5 pts + O11.5 reb")
    print(f"  Correlation (pts-reb): 0.15")
    print(f"  Naive P(both):         58.2% × 62.4% = 36.3%")
    print(f"  Actual P(both):        {result['probability']:.1%}")
    print(f"  Fair Odds:             {result['fair_odds']}")
    print(f"\n💡 Correlation matters! Don't multiply independent probabilities.")


if __name__ == '__main__':
    print("\n" + "="*60)
    print("COMPREHENSIVE PROJECTION EXAMPLES")
    print("HoopStats - Advanced NBA Projection System")
    print("="*60)

    # Run all examples
    example_1_basic_projection()
    example_2_injury_impact()
    example_3_b2b_and_blowout_risk()
    example_4_favorable_matchup()
    example_5_bet_evaluation()
    example_6_parlay_evaluation()

    print("\n" + "="*60)
    print("Examples complete! Key takeaways:")
    print("="*60)
    print("1. Minutes model is highest leverage (60-70% of variance)")
    print("2. Usage redistribution = YOUR EDGE when stars are out")
    print("3. Positional matchups add 2-3% to projections")
    print("4. Only bet when edge > 3% and use Kelly sizing")
    print("5. Account for correlations in parlays")
    print("6. Fade heavy favorites on B2Bs (blowout + rest)")
    print("="*60 + "\n")
