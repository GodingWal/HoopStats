#!/usr/bin/env python3
"""
Referee Assignment Scraper v2 for CourtSideEdge.
Fetches referee assignments from NBA.com live scoreboard and box scores.
Falls back to historical tendency data when assignments aren't posted.

Run daily before projections (usually ~30min before game time).
"""
import os, sys, json, logging, re, time
from datetime import datetime, date, timedelta
import psycopg2
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL',
    'postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge')

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.nba.com/',
    'Accept': 'application/json',
    'x-nba-stats-origin': 'stats',
    'x-nba-stats-token': 'true',
}

# Historical referee tendencies (avg fouls per game)
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
    "Sean Corbin": 42.5, "Brent Barnaky": 43.0, "Lauren Holtkamp-Sterling": 42.5,
    "Matt Kallio": 42.0, "Brandon Schwab": 42.0, "Haywoode Workman": 43.0,
    "CJ Washington": 42.5, "Dedric Taylor": 43.0, "John Butler": 42.0,
    "Andy Nagy": 43.5, "Evan Scott": 42.0, "Danielle Scott": 41.5,
    "Dannica Mosher": 42.0, "Suyash Mehta": 43.0, "Jenna Schroeder": 42.5,
}


def get_db():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None


def fetch_games_for_date(target_date):
    """Fetch today's games from NBA scoreboard API."""
    games = []
    date_str = target_date.strftime('%Y-%m-%d')

    # Try NBA CDN scoreboard first
    urls = [
        "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json",
        f"https://stats.nba.com/stats/scoreboardv3?GameDate={date_str}&LeagueID=00",
    ]

    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code == 200:
                data = r.json()
                scoreboard = data.get('scoreboard', data)
                game_list = scoreboard.get('games', [])
                for g in game_list:
                    gid = g.get('gameId', '')
                    ht = g.get('homeTeam', {}).get('teamTricode', '')
                    at = g.get('awayTeam', {}).get('teamTricode', '')
                    if gid and ht and at:
                        games.append({'game_id': gid, 'home_team': ht, 'away_team': at})
                if games:
                    logger.info(f"Got {len(games)} games from NBA scoreboard")
                    return games
        except Exception as e:
            logger.warning(f"Scoreboard URL failed: {e}")

    # Fallback: check our games table
    conn = get_db()
    if conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT game_id, home_team, visitor_team FROM games
            WHERE game_date = %s
        """, (target_date,))
        for row in cur.fetchall():
            games.append({'game_id': row[0], 'home_team': row[1], 'away_team': row[2]})
        cur.close()
        conn.close()
        if games:
            logger.info(f"Got {len(games)} games from local DB")

    return games


def fetch_referees_from_boxscore(game_id):
    """Try to get referee names from NBA box score API."""
    refs = []
    urls = [
        f"https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{game_id}.json",
        f"https://stats.nba.com/stats/boxscoresummaryv2?GameID={game_id}",
    ]

    for url in urls:
        try:
            r = requests.get(url, headers=HEADERS, timeout=15)
            if r.status_code != 200:
                continue
            data = r.json()

            # CDN box score format
            if 'game' in data:
                officials = data['game'].get('officials', [])
                for off in officials:
                    name = off.get('name', '')
                    if not name:
                        fn = off.get('firstName', '')
                        ln = off.get('lastName', '')
                        name = f"{fn} {ln}".strip()
                    ref_id = str(off.get('personId', ''))
                    if name:
                        refs.append({'name': name, 'ref_id': ref_id})

            # Stats API format
            elif 'resultSets' in data:
                for rs in data['resultSets']:
                    if rs.get('name') == 'Officials':
                        headers_list = rs.get('headers', [])
                        for row in rs.get('rowSet', []):
                            rd = dict(zip(headers_list, row))
                            fn = rd.get('FIRST_NAME', '')
                            ln = rd.get('LAST_NAME', '')
                            name = f"{fn} {ln}".strip()
                            ref_id = str(rd.get('OFFICIAL_ID', ''))
                            if name:
                                refs.append({'name': name, 'ref_id': ref_id})

            if refs:
                return refs
        except Exception as e:
            logger.debug(f"Box score fetch failed for {game_id}: {e}")
        time.sleep(0.8)

    return refs


def fetch_referees_nba_api(game_id):
    """Use nba_api library as another source."""
    try:
        from nba_api.live.nba.endpoints import boxscore
        bs = boxscore.BoxScore(game_id=game_id)
        data = bs.get_dict()
        officials = data.get('game', {}).get('officials', [])
        refs = []
        for off in officials:
            name = off.get('name', '')
            if not name:
                fn = off.get('firstName', '')
                ln = off.get('lastName', '')
                name = f"{fn} {ln}".strip()
            ref_id = str(off.get('personId', ''))
            if name:
                refs.append({'name': name, 'ref_id': ref_id})
        return refs
    except Exception as e:
        logger.debug(f"nba_api boxscore failed for {game_id}: {e}")
        return []


def store_referee_assignments(conn, game_date, assignments):
    """Store referee assignments in database."""
    if not assignments:
        return 0

    cur = conn.cursor()
    stored = 0
    try:
        # Clear existing for this date
        cur.execute("DELETE FROM referee_assignments WHERE game_date = %s", (game_date,))

        for a in assignments:
            avg_fouls = REFEREE_TENDENCIES.get(a['referee_name'], 42.0)
            cur.execute("""
                INSERT INTO referee_assignments
                    (game_date, game_id, home_team, away_team, referee_name, referee_id, avg_fouls_per_game)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (game_date, a['game_id'], a['home_team'], a['away_team'],
                  a['referee_name'], a.get('referee_id', ''), avg_fouls))
            stored += 1

        conn.commit()
        logger.info(f"Stored {stored} referee assignments for {game_date}")
    except Exception as e:
        conn.rollback()
        logger.error(f"Store failed: {e}")
    finally:
        cur.close()

    return stored


def main():
    target_date = date.today()
    # Allow override via CLI arg
    if len(sys.argv) > 1:
        try:
            target_date = datetime.strptime(sys.argv[1], '%Y-%m-%d').date()
        except:
            pass

    logger.info(f"=== Fetching referee assignments for {target_date} ===")

    # Step 1: Get today's games
    games = fetch_games_for_date(target_date)
    if not games:
        logger.warning("No games found for today")
        return

    logger.info(f"Found {len(games)} games")

    # Step 2: For each game, try to get referee assignments
    assignments = []
    for game in games:
        gid = game['game_id']
        logger.info(f"Fetching refs for {game['away_team']} @ {game['home_team']} ({gid})")

        # Try direct API first
        refs = fetch_referees_from_boxscore(gid)

        # Fallback to nba_api library
        if not refs:
            refs = fetch_referees_nba_api(gid)
            time.sleep(1)

        if refs:
            for ref in refs:
                assignments.append({
                    'game_id': gid,
                    'home_team': game['home_team'],
                    'away_team': game['away_team'],
                    'referee_name': ref['name'],
                    'referee_id': ref.get('ref_id', ''),
                })
            logger.info(f"  Found {len(refs)} refs: {[r['name'] for r in refs]}")
        else:
            logger.warning(f"  No refs found for game {gid} - may not be posted yet")

        time.sleep(0.5)

    # Step 3: Store in database
    conn = get_db()
    if conn:
        stored = store_referee_assignments(conn, target_date, assignments)
        conn.close()
        logger.info(f"Total: {stored} referee assignments stored")
    else:
        logger.error("Could not connect to database")

    logger.info("=== Done ===")


if __name__ == '__main__':
    main()
