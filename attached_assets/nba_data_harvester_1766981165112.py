"""
NBA Betting Analytics Data Harvester
Collects player stats, game logs, matchup data for betting analysis
"""

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
import pandas as pd
import numpy as np

from nba_api.stats.endpoints import (
    playergamelog,
    commonplayerinfo,
    leaguedashplayerstats,
    teamgamelog,
    leaguegamefinder,
    playerdashboardbygeneralsplits,
    commonteamroster
)
from nba_api.stats.static import players, teams

# Rate limiting to avoid API blocks
REQUEST_DELAY = 0.6

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


def get_all_active_players():
    """Get all active NBA players"""
    all_players = players.get_active_players()
    return all_players


def get_all_teams():
    """Get all NBA teams"""
    return teams.get_teams()


def get_player_season_stats(season="2024-25"):
    """Get all players' season averages"""
    print(f"Fetching season stats for {season}...")
    
    stats = leaguedashplayerstats.LeagueDashPlayerStats(
        season=season,
        per_mode_detailed="PerGame"
    )
    time.sleep(REQUEST_DELAY)
    
    df = stats.get_data_frames()[0]
    
    # Select relevant columns for betting
    columns = [
        'PLAYER_ID', 'PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION',
        'GP', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TOV',
        'FGM', 'FGA', 'FG_PCT', 'FG3M', 'FG3A', 'FG3_PCT',
        'FTM', 'FTA', 'FT_PCT', 'PLUS_MINUS'
    ]
    
    df = df[columns].copy()
    
    # Add combined stats for betting (PRA, PA, PR, RA)
    df['PRA'] = df['PTS'] + df['REB'] + df['AST']
    df['PA'] = df['PTS'] + df['AST']
    df['PR'] = df['PTS'] + df['REB']
    df['RA'] = df['REB'] + df['AST']
    df['STOCKS'] = df['STL'] + df['BLK']
    
    return df.to_dict(orient='records')


def get_player_game_log(player_id, season="2024-25", last_n=None):
    """Get a player's game log for the season"""
    try:
        log = playergamelog.PlayerGameLog(
            player_id=player_id,
            season=season
        )
        time.sleep(REQUEST_DELAY)
        
        df = log.get_data_frames()[0]
        
        if df.empty:
            return []
        
        # Add computed stats
        df['PRA'] = df['PTS'] + df['REB'] + df['AST']
        df['PA'] = df['PTS'] + df['AST']
        df['PR'] = df['PTS'] + df['REB']
        df['RA'] = df['REB'] + df['AST']
        df['STOCKS'] = df['STL'] + df['BLK']
        
        # Parse matchup to get opponent
        df['OPPONENT'] = df['MATCHUP'].apply(lambda x: x.split()[-1])
        df['HOME'] = df['MATCHUP'].apply(lambda x: 'vs.' in x)
        
        if last_n:
            df = df.head(last_n)
        
        return df.to_dict(orient='records')
    
    except Exception as e:
        print(f"Error fetching game log for player {player_id}: {e}")
        return []


def calculate_last_n_averages(game_log, n=10):
    """Calculate averages over last N games"""
    if not game_log or len(game_log) == 0:
        return {}
    
    games = game_log[:n] if len(game_log) >= n else game_log
    
    stats = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'MIN', 'PRA', 'PA', 'PR', 'RA', 'STOCKS', 'TOV']
    
    averages = {}
    for stat in stats:
        values = [g.get(stat, 0) for g in games if g.get(stat) is not None]
        if values:
            averages[stat] = round(sum(values) / len(values), 1)
            averages[f'{stat}_HIT_RATE'] = {}  # Will calculate hit rates for common lines
    
    averages['GAMES_PLAYED'] = len(games)
    
    return averages


def calculate_vs_team_stats(game_log, team_abbr):
    """Calculate player's stats against a specific team"""
    if not game_log:
        return {}
    
    vs_games = [g for g in game_log if g.get('OPPONENT') == team_abbr]
    
    if not vs_games:
        return {'games': 0}
    
    stats = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG3M', 'MIN', 'PRA', 'PA', 'PR', 'RA', 'STOCKS']
    
    averages = {'games': len(vs_games)}
    for stat in stats:
        values = [g.get(stat, 0) for g in vs_games if g.get(stat) is not None]
        if values:
            averages[stat] = round(sum(values) / len(values), 1)
    
    return averages


def calculate_hit_rates(game_log, stat, lines):
    """Calculate hit rates for different betting lines"""
    if not game_log:
        return {}
    
    hit_rates = {}
    for line in lines:
        hits = sum(1 for g in game_log if g.get(stat, 0) >= line)
        hit_rates[str(line)] = round(hits / len(game_log) * 100, 1)
    
    return hit_rates


def get_team_roster_with_stats(team_id, season="2024-25"):
    """Get team roster with current season stats"""
    try:
        roster = commonteamroster.CommonTeamRoster(
            team_id=team_id,
            season=season
        )
        time.sleep(REQUEST_DELAY)
        
        df = roster.get_data_frames()[0]
        return df[['PLAYER_ID', 'PLAYER', 'NUM', 'POSITION']].to_dict(orient='records')
    
    except Exception as e:
        print(f"Error fetching roster for team {team_id}: {e}")
        return []


def analyze_teammate_impact(player_id, team_id, season="2024-25"):
    """
    Analyze how a player's absence affects teammates' stats
    This is the key feature for betting analysis
    """
    print(f"Analyzing teammate impact for player {player_id}...")
    
    # Get team game log
    try:
        team_log = teamgamelog.TeamGameLog(
            team_id=team_id,
            season=season
        )
        time.sleep(REQUEST_DELAY)
        team_games = team_log.get_data_frames()[0]
    except Exception as e:
        print(f"Error fetching team games: {e}")
        return {}
    
    # Get player's game log to identify games missed
    player_games = get_player_game_log(player_id, season)
    
    if not player_games:
        return {}
    
    # Find games where player didn't play
    player_game_ids = set(g['Game_ID'] for g in player_games)
    team_game_ids = set(team_games['Game_ID'].tolist())
    
    missed_game_ids = team_game_ids - player_game_ids
    
    if not missed_game_ids:
        return {'games_missed': 0, 'message': 'Player has played all team games'}
    
    # Get roster
    roster = get_team_roster_with_stats(team_id, season)
    
    # For each teammate, calculate stats with/without the player
    teammate_impact = {}
    
    for teammate in roster:
        if teammate['PLAYER_ID'] == player_id:
            continue
        
        teammate_games = get_player_game_log(teammate['PLAYER_ID'], season)
        
        if not teammate_games:
            continue
        
        # Split into games with/without the analyzed player
        games_with = [g for g in teammate_games if g['Game_ID'] in player_game_ids]
        games_without = [g for g in teammate_games if g['Game_ID'] in missed_game_ids]
        
        if not games_with or not games_without:
            continue
        
        # Calculate averages
        stats = ['PTS', 'REB', 'AST', 'FG3M', 'MIN', 'PRA']
        
        impact = {
            'player_name': teammate['PLAYER'],
            'games_with': len(games_with),
            'games_without': len(games_without),
            'stats': {}
        }
        
        for stat in stats:
            with_avg = sum(g.get(stat, 0) for g in games_with) / len(games_with)
            without_avg = sum(g.get(stat, 0) for g in games_without) / len(games_without)
            
            impact['stats'][stat] = {
                'with_player': round(with_avg, 1),
                'without_player': round(without_avg, 1),
                'difference': round(without_avg - with_avg, 1),
                'pct_change': round((without_avg - with_avg) / max(with_avg, 0.1) * 100, 1)
            }
        
        teammate_impact[teammate['PLAYER_ID']] = impact
    
    return {
        'games_missed': len(missed_game_ids),
        'teammate_impact': teammate_impact
    }


def build_player_profile(player_id, player_name, team_id, team_abbr, season="2024-25"):
    """Build comprehensive player profile for betting analysis"""
    print(f"Building profile for {player_name}...")
    
    # Get full season game log
    game_log = get_player_game_log(player_id, season)
    
    if not game_log:
        return None
    
    # Season averages from game log
    season_avgs = calculate_last_n_averages(game_log, n=len(game_log))
    
    # Last 10 games
    last_10_avgs = calculate_last_n_averages(game_log, n=10)
    
    # Last 5 games
    last_5_avgs = calculate_last_n_averages(game_log, n=5)
    
    # Calculate hit rates for common lines
    common_lines = {
        'PTS': [10.5, 15.5, 20.5, 25.5, 30.5],
        'REB': [3.5, 5.5, 7.5, 9.5],
        'AST': [2.5, 4.5, 6.5, 8.5],
        'FG3M': [0.5, 1.5, 2.5, 3.5],
        'PRA': [15.5, 20.5, 25.5, 30.5, 35.5, 40.5],
        'STOCKS': [1.5, 2.5, 3.5]
    }
    
    hit_rates = {}
    for stat, lines in common_lines.items():
        hit_rates[stat] = calculate_hit_rates(game_log, stat, lines)
    
    # Vs each team
    all_teams = get_all_teams()
    vs_team_stats = {}
    for team in all_teams:
        if team['abbreviation'] != team_abbr:
            vs_stats = calculate_vs_team_stats(game_log, team['abbreviation'])
            if vs_stats.get('games', 0) > 0:
                vs_team_stats[team['abbreviation']] = vs_stats
    
    # Home vs Away splits
    home_games = [g for g in game_log if g.get('HOME')]
    away_games = [g for g in game_log if not g.get('HOME')]
    
    home_avgs = calculate_last_n_averages(home_games, n=len(home_games)) if home_games else {}
    away_avgs = calculate_last_n_averages(away_games, n=len(away_games)) if away_games else {}
    
    return {
        'player_id': player_id,
        'player_name': player_name,
        'team_id': team_id,
        'team': team_abbr,
        'season': season,
        'games_played': len(game_log),
        'season_averages': season_avgs,
        'last_10_averages': last_10_avgs,
        'last_5_averages': last_5_avgs,
        'hit_rates': hit_rates,
        'vs_team': vs_team_stats,
        'home_averages': home_avgs,
        'away_averages': away_avgs,
        'recent_games': game_log[:10],  # Last 10 game details
        'updated_at': datetime.now().isoformat()
    }


def harvest_top_players(n_players=100, season="2024-25"):
    """Harvest data for top N players by minutes played"""
    print(f"Harvesting data for top {n_players} players...")
    
    # Get season stats to identify top players
    season_stats = get_player_season_stats(season)
    
    # Sort by minutes and get top N
    sorted_players = sorted(season_stats, key=lambda x: x.get('MIN', 0), reverse=True)[:n_players]
    
    player_profiles = []
    
    for i, player in enumerate(sorted_players):
        print(f"Processing {i+1}/{n_players}: {player['PLAYER_NAME']}")
        
        profile = build_player_profile(
            player['PLAYER_ID'],
            player['PLAYER_NAME'],
            player['TEAM_ID'],
            player['TEAM_ABBREVIATION'],
            season
        )
        
        if profile:
            # Add season stats to profile
            profile['season_stats'] = player
            player_profiles.append(profile)
    
    return player_profiles


def save_data(data, filename):
    """Save data to JSON file"""
    filepath = DATA_DIR / filename
    with open(filepath, 'w') as f:
        json.dump(data, f, indent=2, default=str)
    print(f"Saved data to {filepath}")


def load_data(filename):
    """Load data from JSON file"""
    filepath = DATA_DIR / filename
    if filepath.exists():
        with open(filepath, 'r') as f:
            return json.load(f)
    return None


def main():
    """Main harvesting function"""
    season = "2024-25"
    
    print("=" * 50)
    print("NBA Betting Analytics Data Harvester")
    print("=" * 50)
    
    # Get all teams
    all_teams = get_all_teams()
    save_data(all_teams, "teams.json")
    
    # Get season stats for all players
    season_stats = get_player_season_stats(season)
    save_data(season_stats, "season_stats.json")
    
    # Harvest detailed profiles for top players
    # Start with fewer players for initial testing
    profiles = harvest_top_players(n_players=50, season=season)
    save_data(profiles, "player_profiles.json")
    
    print("\n" + "=" * 50)
    print("Data harvesting complete!")
    print(f"Profiles saved: {len(profiles)}")
    print("=" * 50)


if __name__ == "__main__":
    main()
