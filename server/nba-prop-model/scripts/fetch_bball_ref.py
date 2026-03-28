"""
Basketball Reference Team Game Log Scraper

Fetches team game logs from Basketball Reference for the current season
and stores them in the team_game_logs PostgreSQL table.

Respects rate limits: 3-second delays between requests.
Uses proper User-Agent header.

Usage:
    cd /var/www/courtsideedge/server/nba-prop-model
    source venv/bin/activate
    python -m scripts.fetch_bball_ref            # Scrape all teams
    python -m scripts.fetch_bball_ref --team BOS  # Scrape one team
    python -m scripts.fetch_bball_ref --backfill  # Full season backfill
"""

import time
import logging
import argparse
from datetime import datetime
from typing import List, Dict, Optional, Any

import requests
from bs4 import BeautifulSoup
import psycopg2
from psycopg2.extras import execute_values

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from config.db_config import get_connection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# Basketball Reference team abbreviations for 2025-26 season
NBA_TEAMS = {
    'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BRK': 'Brooklyn Nets',
    'CHO': 'Charlotte Hornets', 'CHI': 'Chicago Bulls', 'CLE': 'Cleveland Cavaliers',
    'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons',
    'GSW': 'Golden State Warriors', 'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers',
    'LAC': 'Los Angeles Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
    'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves',
    'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks', 'OKC': 'Oklahoma City Thunder',
    'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHO': 'Phoenix Suns',
    'POR': 'Portland Trail Blazers', 'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs',
    'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards',
}

BBREF_TO_STANDARD = {'BRK': 'BKN', 'CHO': 'CHA', 'PHO': 'PHX'}

SESSION = requests.Session()
SESSION.headers.update({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.9',
})

REQUEST_DELAY = 3.0  # seconds between requests


def standardize_abbr(bbref_abbr: str) -> str:
    """Convert Basketball Reference abbreviation to our standard format."""
    return BBREF_TO_STANDARD.get(bbref_abbr, bbref_abbr)


def fetch_team_game_log(team_abbr: str, season: int = 2026) -> List[Dict[str, Any]]:
    """
    Fetch game log for a team from Basketball Reference.
    Table ID: team_game_log_reg (regular season).
    """
    url = f"https://www.basketball-reference.com/teams/{team_abbr}/{season}/gamelog/"
    logger.info(f"Fetching: {url}")

    try:
        resp = SESSION.get(url, timeout=30)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error(f"Failed to fetch {url}: {e}")
        return []

    soup = BeautifulSoup(resp.text, 'lxml')
    table = soup.find('table', {'id': 'team_game_log_reg'})

    if not table:
        logger.warning(f"No game log table found for {team_abbr}")
        return []

    tbody = table.find('tbody')
    if not tbody:
        return []

    games = []
    std_team = standardize_abbr(team_abbr)

    for row in tbody.find_all('tr'):
        # Skip header rows
        if row.get('class') and ('thead' in row.get('class', [])):
            continue

        cells = {}
        for cell in row.find_all(['th', 'td']):
            ds = cell.get('data-stat')
            if ds:
                cells[ds] = cell.get_text(strip=True)

        # Must have a date
        date_str = cells.get('date', '')
        if not date_str or len(date_str) < 8:
            continue

        try:
            game_date = datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            continue

        # Parse fields
        def to_int(key):
            v = cells.get(key, '')
            try: return int(v)
            except: return None

        def to_float(key):
            v = cells.get(key, '')
            try: return float(v)
            except: return None

        home_away = 'AWAY' if cells.get('game_location', '') == '@' else 'HOME'
        opp_raw = cells.get('opp_name_abbr', '')
        opp = standardize_abbr(opp_raw)
        result = cells.get('team_game_result', '')
        result_char = result[0] if result and result[0] in ('W', 'L') else None

        pts = to_int('team_game_score')
        opp_pts = to_int('opp_team_game_score')

        fg_pct = to_float('fg_pct')
        fg3_pct = to_float('fg3_pct')
        ft_pct = to_float('ft_pct')
        rebounds = to_int('trb')
        assists = to_int('ast')
        steals = to_int('stl')
        blocks = to_int('blk')
        turnovers = to_int('tov')

        # Estimate pace from FGA + FTA (possessions proxy)
        fga = to_int('fg')  # Actually field goals made - need fga
        fga_val = to_int('fga')
        opp_fga_val = to_int('opp_fga')
        fta_val = to_int('fta')
        opp_fta_val = to_int('opp_fta')
        tov_val = to_int('tov')
        opp_tov_val = to_int('opp_tov')
        orb_val = to_int('orb')
        opp_orb_val = to_int('opp_orb')

        pace_est = None
        off_rtg_est = None
        def_rtg_est = None

        # Possessions estimate: FGA - ORB + TOV + 0.44*FTA
        if all(v is not None for v in [fga_val, fta_val, tov_val, orb_val]):
            team_poss = fga_val - orb_val + (tov_val or 0) + 0.44 * fta_val
            if all(v is not None for v in [opp_fga_val, opp_fta_val, opp_tov_val, opp_orb_val]):
                opp_poss = opp_fga_val - opp_orb_val + (opp_tov_val or 0) + 0.44 * opp_fta_val
                avg_poss = (team_poss + opp_poss) / 2.0
                if avg_poss > 0:
                    pace_est = round(avg_poss, 2)
                    if pts is not None:
                        off_rtg_est = round(pts / avg_poss * 100, 2)
                    if opp_pts is not None:
                        def_rtg_est = round(opp_pts / avg_poss * 100, 2)

        games.append({
            'team_abbr': std_team,
            'game_date': game_date,
            'opponent': opp,
            'home_away': home_away,
            'result': result_char,
            'pts': pts,
            'opp_pts': opp_pts,
            'fg_pct': fg_pct,
            'fg3_pct': fg3_pct,
            'ft_pct': ft_pct,
            'rebounds': rebounds,
            'assists': assists,
            'steals': steals,
            'blocks': blocks,
            'turnovers': turnovers,
            'pace': pace_est,
            'off_rtg': off_rtg_est,
            'def_rtg': def_rtg_est,
        })

    logger.info(f"Parsed {len(games)} games for {team_abbr}")
    return games


def upsert_games(conn, games: List[Dict[str, Any]]) -> int:
    """Insert or update game logs using ON CONFLICT."""
    if not games:
        return 0

    sql = """
        INSERT INTO team_game_logs
            (team_abbr, game_date, opponent, home_away, result, pts, opp_pts,
             fg_pct, fg3_pct, ft_pct, rebounds, assists, steals, blocks,
             turnovers, pace, off_rtg, def_rtg)
        VALUES %s
        ON CONFLICT (team_abbr, game_date) DO UPDATE SET
            opponent = EXCLUDED.opponent,
            home_away = EXCLUDED.home_away,
            result = EXCLUDED.result,
            pts = EXCLUDED.pts,
            opp_pts = EXCLUDED.opp_pts,
            fg_pct = EXCLUDED.fg_pct,
            fg3_pct = EXCLUDED.fg3_pct,
            ft_pct = EXCLUDED.ft_pct,
            rebounds = EXCLUDED.rebounds,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            turnovers = EXCLUDED.turnovers,
            pace = EXCLUDED.pace,
            off_rtg = EXCLUDED.off_rtg,
            def_rtg = EXCLUDED.def_rtg
    """

    values = [
        (g['team_abbr'], g['game_date'], g['opponent'], g['home_away'],
         g['result'], g['pts'], g['opp_pts'], g['fg_pct'], g['fg3_pct'],
         g['ft_pct'], g['rebounds'], g['assists'], g['steals'], g['blocks'],
         g['turnovers'], g['pace'], g['off_rtg'], g['def_rtg'])
        for g in games
    ]

    cursor = conn.cursor()
    execute_values(cursor, sql, values)
    conn.commit()
    cursor.close()
    return len(values)


def scrape_all_teams(teams: List[str] = None, season: int = 2026):
    """Scrape game logs for all (or specified) teams with rate limiting."""
    if teams is None:
        teams = list(NBA_TEAMS.keys())

    conn = get_connection()
    total_inserted = 0

    try:
        for i, team in enumerate(teams):
            logger.info(f"[{i+1}/{len(teams)}] Scraping {team} ({NBA_TEAMS.get(team, team)})...")
            games = fetch_team_game_log(team, season)
            if games:
                count = upsert_games(conn, games)
                total_inserted += count
                logger.info(f"  -> Upserted {count} games for {standardize_abbr(team)}")
            else:
                logger.warning(f"  -> No games found for {team}")

            if i < len(teams) - 1:
                time.sleep(REQUEST_DELAY)
    finally:
        conn.close()

    logger.info(f"Done! Total games upserted: {total_inserted}")
    return total_inserted


def main():
    parser = argparse.ArgumentParser(description='Basketball Reference Game Log Scraper')
    parser.add_argument('--team', type=str, help='Scrape a single team (e.g., BOS)')
    parser.add_argument('--season', type=int, default=2026, help='Season end year (default: 2026)')
    parser.add_argument('--backfill', action='store_true', help='Full season backfill')
    args = parser.parse_args()

    if args.team:
        team = args.team.upper()
        if team not in NBA_TEAMS:
            # Check if they passed standard abbr
            reverse = {v: k for k, v in BBREF_TO_STANDARD.items()}
            team = reverse.get(team, team)
        if team not in NBA_TEAMS:
            logger.error(f"Unknown team: {team}")
            sys.exit(1)
        scrape_all_teams([team], args.season)
    else:
        scrape_all_teams(season=args.season)


if __name__ == '__main__':
    main()
