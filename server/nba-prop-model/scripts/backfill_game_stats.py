#!/usr/bin/env python3
"""Backfill player_game_stats table from NBA API using existing NBADataClient."""
import sys, os, time, logging
import psycopg2
from dotenv import load_dotenv

sys.path.append(os.path.join(os.path.dirname(__file__), '..'))
from src.data.nba_api_client import NBADataClient

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger('backfill_game_stats')

DB_URL = os.environ.get('DATABASE_URL', 'postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge')

def get_players(conn):
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT p.player_id, p.team_id, pl.prizepicks_player_id
        FROM players p
        LEFT JOIN (SELECT DISTINCT ON (LOWER(TRIM(player_name))) player_name, prizepicks_player_id FROM prizepicks_lines WHERE prizepicks_player_id IS NOT NULL) pl
        ON LOWER(TRIM(p.player_name)) = LOWER(TRIM(pl.player_name))
        WHERE p.player_id IS NOT NULL AND p.games_played > 0")
    rows = cur.fetchall()
    cur.close()
    return rows

def backfill():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    client = NBADataClient()
    players = get_players(conn)
    logger.info(f"Found {len(players)} players to backfill")
    
    inserted = 0
    errors = 0
    for i, (pid, tid, pp_id) in enumerate(players):
        try:
            df = client.get_player_game_log(player_id=int(pid), season="2025-26")
            if df.empty:
                continue
            cur = conn.cursor()
            for _, row in df.iterrows():
                game_id = str(row.get('Game_ID', ''))
                game_date = row.get('GAME_DATE', None)
                mins = row.get('MIN', 0) or 0
                pts = row.get('PTS', 0) or 0
                reb = row.get('REB', 0) or 0
                ast = row.get('AST', 0) or 0
                fg3m = row.get('FG3M', 0) or 0
                stl = row.get('STL', 0) or 0
                blk = row.get('BLK', 0) or 0
                tov = row.get('TOV', 0) or 0
                fga = row.get('FGA', 0) or 0
                fta = row.get('FTA', 0) or 0
                cur.execute("""
                    INSERT INTO player_game_stats 
                    (player_id, game_id, game_date, team_id, minutes_played, pts, reb, ast, fg3m, stl, blk, tov, fga, fta)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (player_id, game_id) DO NOTHING
                """, (str(pp_id) if pp_id else str(pid), game_id, game_date, str(tid), mins, pts, reb, ast, fg3m, stl, blk, tov, fga, fta))
                inserted += 1
            cur.close()
            if (i+1) % 10 == 0:
                logger.info(f"Processed {i+1}/{len(players)} players, {inserted} rows inserted")
        except Exception as e:
            errors += 1
            logger.warning(f"Error for player {pid}: {e}")
            continue
    
    conn.close()
    logger.info(f"Done! {inserted} rows inserted, {errors} errors")

if __name__ == '__main__':
    backfill()
