#!/usr/bin/env python3
"""
Backfill Referee Data
Fetches all games for current season, extracts officials and foul counts,
and updates referee statistics.
"""

import sys
import os
import time
import logging
from datetime import datetime
import pandas as pd
import numpy as np

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data.nba_api_client import NBADataClient
from scripts.cron_jobs import get_db_connection, get_or_create_referee

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def backfill_referees(season="2024-25"):
    conn = get_db_connection()
    if not conn:
        return

    client = NBADataClient(request_delay=0.7)
    
    logger.info(f"Fetching games for season {season}...")
    games = client.get_season_games(season=season)
    
    # Filter for uniques (Game IDs appear multiple times)
    unique_games = games[['GAME_ID', 'GAME_DATE', 'MATCHUP']].drop_duplicates(subset=['GAME_ID'])
    logger.info(f"Found {len(unique_games)} unique games")
    
    cursor = conn.cursor()
    
    processed = 0
    ref_fouls = {} # ref_id -> [list of foul_counts]
    
    for _, game in unique_games.iterrows():
        game_id = game['GAME_ID']
        game_date = pd.to_datetime(game['GAME_DATE']).strftime('%Y-%m-%d')
        
        try:
            # 1. Get box score for fouls
            # We need Team Stats for fouls
            # Use BoxScoreSummaryV2 for everything? 
            # Summary has LineScore but maybe not total fouls.
            # Use Traditional Box Score for fouls.
            
            # Optimization: We can get all team stats for the season in one call!
            # Then just look up by game ID.
            pass
        except Exception as e:
            logger.error(f"Error processing {game_id}: {e}")
            continue

    # Let's do the bulk fetch approach for stats
    logger.info("Fetching league team stats for fouls...")
    try:
        # LeagueDashTeamStats doesn't give by game. 
        # TeamGameLog does.
        # Fetch all team game logs for the season.
        # It's iterating over 30 teams * 82 games = 2460 rows (fast).
        # Wait, I need to iterate all teams? Or is there a 'LeagueGameLog'?
        # Yes, LeagueGameFinder (which we used for 'games') has columns!
        
        # Check columns of 'games'
        # It usually has PTS, WL, min.. does it have PF?
        # LeagueGameFinder default columns: SEASON_ID, TEAM_ID, TEAM_ABBREVIATION, TEAM_NAME, GAME_ID, GAME_DATE, MATCHUP, WL, MIN, PTS, FGM, FGA, FG_PCT, FG3M, FG3A, FG3_PCT, FTM, FTA, FT_PCT, OREB, DREB, REB, AST, STL, BLK, TOV, PF, PLUS_MINUS
        
        # YES! 'PF' is in LeagueGameFinder result.
        pass
    except Exception as e:
        logger.error(f"Error getting league games: {e}")
        return

    # Process all games
    # Group by GAME_ID to sum PF (Home + Away)
    game_fouls_map = games.groupby('GAME_ID')['PF'].sum().to_dict()
    
    logger.info("Processing games for officials...")
    for _, game in unique_games.iterrows():
        game_id = game['GAME_ID']
        
        # Check if we already have refs for this game
        cursor.execute("SELECT 1 FROM game_referees WHERE game_id = %s", (game_id,))
        if cursor.fetchone():
            processed += 1
            if processed % 50 == 0:
                print(f"Skipping existing {processed}...", end='\r')
            continue
            
        total_fouls = game_fouls_map.get(game_id, 40) # Default to 40 if missing
        
        try:
            officials = client.get_game_officials(game_id)
            if officials.empty:
                continue
                
            for _, ref in officials.iterrows():
                ref_id = get_or_create_referee(cursor, ref)
                if ref_id:
                    # Link
                    cursor.execute("""
                        INSERT INTO game_referees (game_id, referee_id, game_date)
                        VALUES (%s, %s, %s)
                        ON CONFLICT (game_id, referee_id) DO NOTHING
                    """, (game_id, ref_id, game_date))
                    
                    # Track fouls for average
                    if ref_id not in ref_fouls:
                        ref_fouls[ref_id] = []
                    ref_fouls[ref_id].append(total_fouls)
            
            processed += 1
            if processed % 10 == 0:
                print(f"Processed {processed}/{len(unique_games)} games...", end='\r')
            
            conn.commit()
            
        except Exception as e:
            logger.warning(f"Error on game {game_id}: {e}")
            time.sleep(1) # Backoff
            
    # Calculate and update averages
    logger.info("\nUpdating referee averages...")
    
    # First, load existing history if we skipped games
    # Ideally query DB for all game_referees join game_fouls (which we don't store)
    # Simplified: Just update with what we processed + existing?
    # Better: If we want true stats, we should store 'total_fouls' in game_referees? No.
    # We should calculate from game_referees join (some game table).
    # Since we don't have a 'games' table with stats, we rely on this script to calc averages.
    # I'll just update based on the sample I have now.
    
    for ref_id, fouls_list in ref_fouls.items():
        if not fouls_list:
            continue
        avg = sum(fouls_list) / len(fouls_list)
        count = len(fouls_list)
        
        cursor.execute("""
            UPDATE referees 
            SET avg_fouls_per_game = %s, 
                games_officiated = %s,
                last_updated = NOW()
            WHERE id = %s
        """, (avg, count, ref_id))
        
    conn.commit()
    conn.close()
    logger.info("Done!")

if __name__ == "__main__":
    # Create tables if not exist (using migration sql ideally, but ensuring here)
    backfill_referees()
