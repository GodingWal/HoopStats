
"""
Backfill Player Data Script
Fetches comprehensive historical data for all active NBA players and populates the database.
Updates existing players (by name) to preserve FKs, inserts new ones with NBA IDs.
Usage: python scripts/backfill_players.py [--season 2025-26]
"""
import os
import sys
import argparse
import time
import json
import logging
import unicodedata
from datetime import datetime
import pandas as pd
import psycopg2
from psycopg2.extras import Json
from dotenv import load_dotenv

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from src.data.nba_api_client import NBADataClient

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('backfill.log')
    ]
)
logger = logging.getLogger('backfill_players')

def connect_db():
    load_dotenv()
    db_url = os.getenv('DATABASE_URL')
    if not db_url:
        logger.error("DATABASE_URL not found in environment")
        sys.exit(1)
    return psycopg2.connect(db_url)

def calculate_averages(df, window=None):
    """Calculate averages for a dataframe, optionally limiting to last N games."""
    if df.empty:
        return {}
    
    subset = df.head(window) if window else df
    
    # Map API columns to our schema keys
    stats_map = {
        'PTS': 'pts',
        'REB': 'reb',
        'AST': 'ast',
        'STL': 'stl',
        'BLK': 'blk',
        'TOV': 'tov',
        'FG3M': 'fg3m',
        'FGA': 'fga',
        'FTA': 'fta',
        'MIN': 'min'
    }
    
    avgs = {}
    for api_col, schema_key in stats_map.items():
        if api_col in subset.columns:
            avgs[schema_key] = round(float(subset[api_col].mean()), 2)
            
    # Add calculated stats
    if 'pts' in avgs and 'reb' in avgs and 'ast' in avgs:
        avgs['pra'] = round(avgs['pts'] + avgs['reb'] + avgs['ast'], 1)
        
    return avgs

def get_home_away_averages(df):
    """Calculate home and away averages."""
    home_df = df[df['MATCHUP'].str.contains(' vs. ', case=False, na=False)]
    away_df = df[df['MATCHUP'].str.contains(' @ ', case=False, na=False)]
    
    return {
        'home': calculate_averages(home_df),
        'away': calculate_averages(away_df)
    }

def main():
    parser = argparse.ArgumentParser(description='Backfill player data')
    parser.add_argument('--season', type=str, default='2025-26', help='Season to fetch (e.g. 2025-26)')
    parser.add_argument('--limit', type=int, default=None, help='Limit number of players (for testing)')
    args = parser.parse_args()
    
    logger.info(f"Starting backfill for season {args.season}...")
    
    # Init client
    client = NBADataClient(request_delay=0.6)
    
    # Get active players
    logger.info("Fetching active players list...")
    players_df = client.get_all_active_players()
    
    if args.limit:
        players_df = players_df.head(args.limit)
        
    logger.info(f"Found {len(players_df)} players. Starting processing...")
    
    conn = connect_db()
    cursor = conn.cursor()
    
    # Load existing players to map Name -> DB_ID 
    # This prevents duplicates and preserves FKs if names match
    cursor.execute("SELECT id, player_name FROM players")
    existing_players = {}
    for row in cursor.fetchall():
        if row[1]:
            # Normalize DB name for robust matching
            existing_players[normalize_name(row[1])] = row[0]
            existing_players[row[1].lower()] = row[0] # Fallback to simple lower
            
    logger.info(f"Loaded {len(existing_players)} existing players from DB.")
    
    success_count = 0
    error_count = 0
    
    start_time = time.time()
    
    for i, player in players_df.iterrows():
        try:
            api_id = player['id']
            name = player['full_name']
            
            # Progress log
            if i % 10 == 0:
                elapsed = time.time() - start_time
                rate = (i + 1) / (elapsed + 0.1)
                logger.info(f"Processing {i+1}/{len(players_df)}: {name} ({rate:.1f} players/sec)")
            
            # Get game log
            games = client.get_player_game_log(api_id, season=args.season)
            
            if games.empty:
                # logger.debug(f"No games found for {name}")
                continue
                
            # Basic info
            team = games.iloc[0]['TEAM_ABBREVIATION'] if 'TEAM_ABBREVIATION' in games.columns else 'UNK'
            
            # Calculate averages
            season_avgs = calculate_averages(games)
            l5_avgs = calculate_averages(games, window=5)
            l10_avgs = calculate_averages(games, window=10)
            
            splits = get_home_away_averages(games)
            home_avgs = splits['home']
            away_avgs = splits['away']
            
            # Prepare recent games (lightweight version for DB)
            recent_games = []
            for _, game in games.head(10).iterrows():
                recent_games.append({
                    'date': game['GAME_DATE'].strftime('%Y-%m-%d'),
                    'pts': int(game['PTS']),
                    'reb': int(game['REB']),
                    'ast': int(game['AST']),
                    'min': float(game['MIN'])
                })
            
            # Determine Upsert Strategy
            # Try normalized match
            db_id = existing_players.get(normalize_name(name))
            # Try simple lower match
            if not db_id:
                db_id = existing_players.get(name.lower())
            
            if db_id:
                # Update existing row
                cursor.execute("""
                    UPDATE players SET
                        player_name = %s,
                        team = %s,
                        player_id = %s,
                        season_averages = %s,
                        last_5_averages = %s,
                        last_10_averages = %s,
                        home_averages = %s,
                        away_averages = %s,
                        recent_games = %s,
                        games_played = %s
                    WHERE id = %s
                """, (
                    name, team, api_id,
                    Json(season_avgs), Json(l5_avgs), Json(l10_avgs),
                    Json(home_avgs), Json(away_avgs), Json(recent_games),
                    len(games),
                    db_id
                ))
            else:
                # Insert new row
                cursor.execute("""
                    INSERT INTO players (
                        id, player_name, team, player_id,
                        season_averages, last_5_averages, last_10_averages,
                        home_averages, away_averages, recent_games,
                        games_played, 
                        hit_rates, vs_team
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        player_name = EXCLUDED.player_name,
                        team = EXCLUDED.team,
                        season_averages = EXCLUDED.season_averages
                """, (
                    api_id, name, team, api_id,
                    Json(season_avgs), Json(l5_avgs), Json(l10_avgs),
                    Json(home_avgs), Json(away_avgs), Json(recent_games),
                    len(games),
                    Json({}), Json({})
                ))
            
            conn.commit()
            success_count += 1
            
        except Exception as e:
            logger.error(f"Error processing {player.get('full_name', 'Unknown')}: {e}")
            conn.rollback()
            error_count += 1
            
    conn.close()
    logger.info(f"Backfill complete! Success: {success_count}, Errors: {error_count}")

if __name__ == "__main__":
    main()
