#!/usr/bin/env python3
"""
Referee Assignment Scraper for CourtSideEdge.
Scrapes referee assignments from NBA.com official game data.
Falls back to historical referee tendency data.

Run daily before projections.
"""
import os, sys, json, logging, re
from datetime import datetime, date, timedelta
import psycopg2
import requests
import sys
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)


# Known referee tendencies: avg fouls per game from historical data
REFEREE_TENDENCIES = {
    "Tony Brothers": 38.5, "Scott Foster": 39.0, "Ed Malloy": 39.5,
    "Josh Tiven": 42.0, "Sean Wright": 42.5, "James Williams": 41.5,
    "Kane Fitzgerald": 45.5, "Michael Smith": 46.0, "Rodney Mott": 44.5,
    "Curtis Blair": 45.0, "Ben Taylor": 44.0, "Karl Lane": 47.0,
    "JB DeRosa": 46.5, "Eric Lewis": 43.0, "Mark Ayotte": 41.0,
    "Derrick Collins": 43.5, "Kevin Cutler": 42.0, "David Guthrie": 41.5,
    "Brian Forte": 43.0, "Nick Buchert": 44.0, "Tre Maddox": 42.5,
    "Natalie Sago": 41.0, "John Goble": 42.5, "Gediminas Petraitis": 43.0,
    "Kevin Scott": 42.0, "Justin Van Duyne": 43.5, "Matt Boland": 44.0,
    "Phenizee Ransom": 42.0, "Tyler Ford": 42.5, "Leon Wood": 43.0,
    "Pat Fraher": 41.5, "Ray Acosta": 43.5, "Mousa Dagher": 42.0,
    "Bill Kennedy": 44.5, "Bennie Adams": 43.0, "Derek Richardson": 42.5,
    "Jacyn Goble": 42.0, "Mitchell Ervin": 43.0, "Courtney Kirkland": 44.0,
    "Tom Washington": 43.5, "Zach Zarba": 42.0, "James Capers": 41.0,
    "Mark Ayotte": 41.0, "Sean Corbin": 42.5, "Brent Barnaky": 43.0,
    "Lauren Holtkamp-Sterling": 42.5,
}

def get_db():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None

def fetch_todays_games_nba_api(target_date):
    """Fetch today's games from NBA scoreboard API."""
    games = []
    date_str = target_date.strftime('%Y-%m-%d')
    
    # Try NBA CDN scoreboard
    urls = [
        f"https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
        f"https://stats.nba.com/stats/scoreboardv3?GameDate={date_str}&LeagueID=00",
    ]
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.nba.com/',
        'Accept': 'application/json',
    }
    
    for url in urls:
        try:
            r = requests.get(url, headers=headers, timeout=15)
            if r.status_code == 200:
                data = r.json()
                scoreboard = data.get('scoreboard', data)
                game_list = scoreboard.get('games', [])
                for g in game_list:
                    gd = g.get('gameId', '')
                    ht = g.get('homeTeam', {}).get('teamTricode', '')
                    at = g.get('awayTeam', {}).get('teamTricode', '')
                    if ht and at:
                        games.append({'game_id': gd, 'home_team': ht, 'away_team': at})
                if games:
                    logger.info(f"Found {len(games)} games from NBA CDN")
                    return games
        except Exception as e:
            logger.debug(f"NBA CDN failed: {e}")
    
    # Fallback: use games_schedule table
    try:
        conn = get_db()
        if conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT game_id, home_team, away_team FROM games_schedule
                WHERE game_date = %s
            """, (date_str,))
            for row in cur.fetchall():
                games.append({'game_id': str(row[0] or ''), 'home_team': row[1], 'away_team': row[2]})
            cur.close()
            conn.close()
            if games:
                logger.info(f"Found {len(games)} games from games_schedule")
    except Exception as e:
        logger.debug(f"games_schedule fallback failed: {e}")
    
    return games


def fetch_referee_assignments_nba(target_date, games):
    """Try to get referee assignments from NBA.com boxscore data."""
    assignments = []
    date_str = target_date.strftime('%Y-%m-%d')
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.nba.com/',
        'Accept': 'application/json',
    }
    
    for game in games:
        game_id = game.get('game_id', '')
        if not game_id or len(game_id) < 8:
            continue
            
        # Try live boxscore (has officials once game is close to start)
        url = f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json"
        try:
            r = requests.get(url, headers=headers, timeout=10)
            if r.status_code == 200:
                data = r.json()
                gm = data.get('game', {})
                officials = gm.get('officials', [])
                for off in officials:
                    name = off.get('name', '')
                    if not name:
                        fn = off.get('firstName', '')
                        ln = off.get('lastName', '')
                        name = f"{fn} {ln}".strip()
                    if name:
                        ref_id = str(off.get('personId', ''))
                        assignments.append({
                            'game_date': date_str,
                            'game_id': game_id,
                            'home_team': game['home_team'],
                            'away_team': game['away_team'],
                            'referee_name': name,
                            'referee_id': ref_id,
                            'avg_fouls_per_game': REFEREE_TENDENCIES.get(name, 42.0),
                        })
        except Exception as e:
            logger.debug(f"Boxscore fetch failed for {game_id}: {e}")
    
    return assignments


def fetch_referee_assignments_espn(target_date, games):
    """Fallback: try ESPN pregame data for referee assignments."""
    assignments = []
    date_str = target_date.strftime('%Y-%m-%d')
    espn_date = target_date.strftime('%Y%m%d')
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    try:
        url = f"https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates={espn_date}"
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            events = data.get('events', [])
            for event in events:
                comps = event.get('competitions', [{}])
                for comp in comps:
                    ht = ''
                    at = ''
                    for t in comp.get('competitors', []):
                        abbr = t.get('team', {}).get('abbreviation', '')
                        if t.get('homeAway') == 'home':
                            ht = abbr
                        else:
                            at = abbr
                    
                    officials = comp.get('officials', [])
                    for off in officials:
                        name = off.get('displayName', off.get('fullName', ''))
                        if name:
                            assignments.append({
                                'game_date': date_str,
                                'game_id': str(event.get('id', '')),
                                'home_team': ht,
                                'away_team': at,
                                'referee_name': name,
                                'referee_id': str(off.get('id', '')),
                                'avg_fouls_per_game': REFEREE_TENDENCIES.get(name, 42.0),
                            })
            if assignments:
                logger.info(f"Found {len(assignments)} referee assignments from ESPN")
    except Exception as e:
        logger.warning(f"ESPN referee fetch failed: {e}")
    
    return assignments


def store_assignments(conn, assignments, target_date):
    """Store referee assignments in DB."""
    if not assignments:
        logger.warning("No referee assignments to store")
        return 0
    
    cur = conn.cursor()
    try:
        date_str = target_date.strftime('%Y-%m-%d')
        cur.execute("DELETE FROM referee_assignments WHERE game_date = %s", (date_str,))
        
        stored = 0
        for a in assignments:
            cur.execute("""
                INSERT INTO referee_assignments
                    (game_date, game_id, home_team, away_team, referee_name, referee_id, avg_fouls_per_game)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                a['game_date'], a.get('game_id', ''),
                a.get('home_team', ''), a.get('away_team', ''),
                a['referee_name'], a.get('referee_id', ''),
                a.get('avg_fouls_per_game', 42.0),
            ))
            stored += 1
        
        conn.commit()
        logger.info(f"Stored {stored} referee assignments for {date_str}")
        return stored
    except Exception as e:
        conn.rollback()
        logger.error(f"Failed to store referee assignments: {e}")
        return 0
    finally:
        cur.close()


def main(target_date=None):
    if target_date is None:
        target_date = date.today()
    elif isinstance(target_date, str):
        target_date = datetime.strptime(target_date, '%Y-%m-%d').date()
    
    logger.info(f"Fetching referee assignments for {target_date}")
    
    # Get today's games
    games = fetch_todays_games_nba_api(target_date)
    if not games:
        logger.warning("No games found for today")
        return 0
    
    # Try NBA.com first, then ESPN
    assignments = fetch_referee_assignments_nba(target_date, games)
    if not assignments:
        assignments = fetch_referee_assignments_espn(target_date, games)
    
    # If still no assignments, create placeholder entries from games
    # so the system knows games exist (refs may not be announced yet)
    if not assignments and games:
        logger.info("No referee data available yet - creating game placeholders")
        for g in games:
            # Add a placeholder so the referee_impact signal knows games exist
            assignments.append({
                'game_date': target_date.strftime('%Y-%m-%d'),
                'game_id': g.get('game_id', ''),
                'home_team': g['home_team'],
                'away_team': g['away_team'],
                'referee_name': 'TBD',
                'referee_id': '',
                'avg_fouls_per_game': 42.0,
            })
    
    conn = get_db()
    if not conn:
        return 0
    
    try:
        return store_assignments(conn, assignments, target_date)
    finally:
        conn.close()


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--date', default=None, help='Target date YYYY-MM-DD')
    args = parser.parse_args()
    count = main(args.date)
    print(f"Referee assignments stored: {count}")
