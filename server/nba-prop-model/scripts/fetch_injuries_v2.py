#!/usr/bin/env python3
"""
Injury Report Scraper v2 for CourtSideEdge.
Fetches from ESPN + NBA.com official injury report.
Populates both injury_report (daily) and player_injuries (persistent tracking).
"""
import os, sys, json, logging, time
from datetime import datetime, date
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
}

def get_db():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"DB fail: {e}")
        return None

# Status normalization map
STATUS_MAP = {
    'O': 'Out', 'OUT': 'Out', 'D': 'Day-To-Day', 'DTD': 'Day-To-Day',
    'Q': 'Questionable', 'P': 'Probable', 'SUSP': 'Suspended',
    'DOUBTFUL': 'Doubtful', 'DOU': 'Doubtful',
}


def fetch_espn_injuries():
    """Fetch injuries from ESPN API."""
    injuries = []
    try:
        r = requests.get(
            "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries",
            timeout=15, headers={'User-Agent': 'Mozilla/5.0'}
        )
        if r.status_code == 200:
            for td in r.json().get('items', []):
                ti = td.get('team', {})
                ta = ti.get('abbreviation', '')
                tid = ti.get('id', '')
                for ai in td.get('injuries', []):
                    a = ai.get('athlete', {})
                    s = ai.get('status', '')
                    sr = s if isinstance(s, str) else s.get('type', {}).get('abbreviation', 'Unknown')
                    injuries.append({
                        'player_id': str(a.get('id', '')),
                        'player_name': a.get('displayName', a.get('fullName', 'Unknown')),
                        'team_id': str(tid),
                        'team': ta,
                        'status': STATUS_MAP.get(sr.upper(), sr),
                        'injury_detail': str(ai.get('details', ''))[:200],
                        'source': 'espn',
                    })
            logger.info(f"Fetched {len(injuries)} injuries from ESPN")
    except Exception as e:
        logger.warning(f"ESPN fail: {e}")
    return injuries


def fetch_nba_official_injuries():
    """Fetch from NBA.com official injury report."""
    injuries = []
    try:
        url = "https://cdn.nba.com/static/json/liveData/odds/odds_todaysGames.json"
        # Try the official injury report endpoint
        url2 = "https://stats.nba.com/stats/playerindex?Season=2025-26&IsOnlyCurrentSeason=1"
        # The NBA doesn't have a clean injury-only endpoint, ESPN is more reliable
        pass
    except Exception as e:
        logger.warning(f"NBA official injuries fail: {e}")
    return injuries


def fetch_cbs_injuries():
    """Fetch from CBS Sports injury page as additional source."""
    injuries = []
    try:
        from nba_api.stats.endpoints import playerindex
        # nba_api doesn't have a direct injury endpoint
        # CBS Sports page would require HTML parsing - skip for now
        pass
    except Exception as e:
        logger.debug(f"CBS injuries fail: {e}")
    return injuries


def merge_injuries(espn_injuries, other_injuries):
    """Merge injuries from multiple sources, preferring ESPN data."""
    seen = {}
    for inj in espn_injuries:
        key = (inj['player_name'].lower(), inj['team'])
        seen[key] = inj

    for inj in other_injuries:
        key = (inj['player_name'].lower(), inj['team'])
        if key not in seen:
            seen[key] = inj

    return list(seen.values())


def store_injury_report(conn, injuries, game_date):
    """Store daily injury report snapshot."""
    if not injuries:
        return 0
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM injury_report WHERE game_date = %s", (game_date,))
        for i in injuries:
            cur.execute("""
                INSERT INTO injury_report
                    (player_id, player_name, team_id, team, status, injury_detail, game_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (i['player_id'], i['player_name'], i['team_id'], i['team'],
                  i['status'], i.get('injury_detail', ''), game_date))
        conn.commit()
        logger.info(f"Stored {len(injuries)} injuries in injury_report for {game_date}")
        return len(injuries)
    except Exception as e:
        conn.rollback()
        logger.error(f"Store injury_report failed: {e}")
        return 0
    finally:
        cur.close()


def update_player_injuries(conn, injuries):
    """Update persistent player_injuries tracking table."""
    cur = conn.cursor()
    updated = 0
    try:
        # Mark all existing active injuries as potentially resolved
        now = datetime.now()

        for i in injuries:
            # Try to find matching player_id in our players table
            cur.execute(
                "SELECT player_id FROM players WHERE player_name ILIKE %s LIMIT 1",
                (i['player_name'],)
            )
            row = cur.fetchone()
            db_player_id = row[0] if row else None

            if db_player_id:
                # Check if player already has an active injury
                cur.execute("""
                    SELECT id, status FROM player_injuries
                    WHERE player_id = %s AND is_active = true
                    LIMIT 1
                """, (db_player_id,))
                existing = cur.fetchone()

                if existing:
                    # Update existing injury
                    old_status = existing[1]
                    cur.execute("""
                        UPDATE player_injuries SET
                            status = %s, injury_type = %s, last_updated = %s,
                            status_changed_at = CASE WHEN status != %s THEN %s ELSE status_changed_at END
                        WHERE id = %s
                    """, (i['status'], i.get('injury_detail', ''), now,
                          i['status'], now, existing[0]))
                else:
                    # Insert new injury
                    cur.execute("""
                        INSERT INTO player_injuries
                            (player_id, player_name, team, team_id, status, injury_type,
                             source, first_reported, last_updated, status_changed_at, is_active)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, true)
                    """, (db_player_id, i['player_name'], i['team'],
                          None,  # team_id as int - skip if we don't have it
                          i['status'], i.get('injury_detail', ''),
                          i.get('source', 'espn'), now, now, now))
                updated += 1

        # Mark players no longer on injury report as recovered
        injured_names = [i['player_name'] for i in injuries]
        if injured_names:
            placeholders = ','.join(['%s'] * len(injured_names))
            cur.execute(f"""
                UPDATE player_injuries SET is_active = false, last_updated = %s
                WHERE is_active = true AND player_name NOT IN ({placeholders})
            """, [now] + injured_names)

        conn.commit()
        logger.info(f"Updated {updated} entries in player_injuries")
    except Exception as e:
        conn.rollback()
        logger.error(f"Update player_injuries failed: {e}")
    finally:
        cur.close()

    return updated


def calc_redistribution(conn, game_date):
    """Calculate usage redistribution when stars are out."""
    cur = conn.cursor()
    redist = {}
    try:
        cur.execute("""
            SELECT DISTINCT team, player_id, player_name
            FROM injury_report
            WHERE game_date = %s AND status IN ('Out', 'Suspended')
        """, (game_date,))
        out_players = cur.fetchall()
        if not out_players:
            return redist

        teams = {}
        for team, pid, pname in out_players:
            if team not in teams:
                teams[team] = []
            teams[team].append({'player_id': pid, 'player_name': pname})

        for team, players in teams.items():
            logger.info(f"  {team}: {len(players)} players out - {[p['player_name'] for p in players]}")
            redist[team] = {'out_players': players, 'count': len(players)}

    except Exception as e:
        logger.error(f"Redistribution calc failed: {e}")
    finally:
        cur.close()

    return redist


def main():
    game_date = date.today()
    if len(sys.argv) > 1:
        try:
            game_date = datetime.strptime(sys.argv[1], '%Y-%m-%d').date()
        except:
            pass

    logger.info(f"=== Fetching injury reports for {game_date} ===")

    # Fetch from all sources
    espn = fetch_espn_injuries()
    nba_official = fetch_nba_official_injuries()

    # Merge
    injuries = merge_injuries(espn, nba_official)
    logger.info(f"Total unique injuries: {len(injuries)}")

    # Store
    conn = get_db()
    if conn:
        store_injury_report(conn, injuries, game_date)
        update_player_injuries(conn, injuries)
        redist = calc_redistribution(conn, game_date)
        if redist:
            logger.info(f"Teams with key players out: {list(redist.keys())}")
        conn.close()
    else:
        logger.error("Could not connect to database")

    logger.info("=== Done ===")


if __name__ == '__main__':
    main()
