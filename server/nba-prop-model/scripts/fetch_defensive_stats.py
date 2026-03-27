#!/usr/bin/env python3
"""
Defensive Stats Scraper for CourtSideEdge.
Populates team_defense and team_defense_by_position tables.
Uses nba_api for team defensive ratings and positional defense data.
"""
import os, sys, time, logging
from datetime import datetime
import psycopg2
import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get('DATABASE_URL',
    'postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge')

# NBA team ID to abbreviation mapping
TEAM_ID_TO_ABBR = {
    1610612737: 'ATL', 1610612738: 'BOS', 1610612739: 'CLE', 1610612740: 'NOP',
    1610612741: 'CHI', 1610612742: 'DAL', 1610612743: 'DEN', 1610612744: 'GSW',
    1610612745: 'HOU', 1610612746: 'LAC', 1610612747: 'LAL', 1610612748: 'MIA',
    1610612749: 'MIL', 1610612750: 'MIN', 1610612751: 'BKN', 1610612752: 'NYK',
    1610612753: 'ORL', 1610612754: 'IND', 1610612755: 'PHI', 1610612756: 'PHX',
    1610612757: 'POR', 1610612758: 'SAC', 1610612759: 'SAS', 1610612760: 'OKC',
    1610612761: 'TOR', 1610612762: 'UTA', 1610612763: 'MEM', 1610612764: 'WAS',
    1610612765: 'DET', 1610612766: 'CHA',
}
ABBR_TO_TEAM_ID = {v: k for k, v in TEAM_ID_TO_ABBR.items()}


def get_db():
    try:
        return psycopg2.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"DB fail: {e}")
        return None


def get_season():
    now = datetime.now()
    year = now.year
    return f"{year}-{str(year+1)[2:]}" if now.month >= 10 else f"{year-1}-{str(year)[2:]}"


def fetch_team_defense_ratings(season):
    """Fetch team defensive ratings using nba_api."""
    try:
        from nba_api.stats.endpoints import leaguedashteamstats
        logger.info(f"Fetching team defense ratings for {season}...")
        stats = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense='Opponent',
            per_mode_detailed='PerGame',
        )
        time.sleep(2)
        df = stats.get_data_frames()[0]
        logger.info(f"Got defensive stats for {len(df)} teams")

        teams = []
        for _, row in df.iterrows():
            tid = int(row.get('TEAM_ID', 0))
            abbr = TEAM_ID_TO_ABBR.get(tid, '')
            if not abbr:
                continue
            teams.append({
                'team_id': tid,
                'team_abbr': abbr,
                'season': season,
                'def_rating': float(row.get('DEF_RATING', 0)) if 'DEF_RATING' in row.index else None,
                'pace': float(row.get('PACE', 0)) if 'PACE' in row.index else None,
                'opp_pts_allowed': float(row.get('OPP_PTS', row.get('PTS', 0))),
                'opp_reb_allowed': float(row.get('OPP_REB', row.get('REB', 0))),
                'opp_ast_allowed': float(row.get('OPP_AST', row.get('AST', 0))),
                'opp_3pt_pct_allowed': float(row.get('OPP_FG3_PCT', row.get('FG3_PCT', 0))),
            })
        return teams
    except Exception as e:
        logger.error(f"Failed to fetch team defense ratings: {e}")
        return []


def fetch_defense_by_position(season):
    """Fetch positional defense data. Uses LeagueDashPlayerStats grouped by position."""
    positions_data = {}

    try:
        from nba_api.stats.endpoints import leaguedashplayerstats

        # Get all player stats with position info
        logger.info("Fetching player stats for positional defense calc...")
        ldps = leaguedashplayerstats.LeagueDashPlayerStats(
            season=season,
            per_mode_detailed='PerGame',
            measure_type_detailed_defense='Opponent',
        )
        time.sleep(2)
        df = ldps.get_data_frames()[0]

        if not df.empty and 'TEAM_ID' in df.columns:
            logger.info(f"Got opponent stats for {len(df)} entries")
            # This gives us team-level opponent stats, not positional
            # We'll estimate positional splits from team totals

    except Exception as e:
        logger.warning(f"Opponent stats fetch failed: {e}")

    # Try LeagueDashPtDefend for actual positional data
    try:
        from nba_api.stats.endpoints import leaguedashptdefend

        pos_categories = {
            'Overall': ['PG', 'SG', 'SF', 'PF', 'C'],
        }

        for category in ['Guard', 'Forward', 'Center']:
            try:
                logger.info(f"Fetching defense vs {category}...")
                result = leaguedashptdefend.LeagueDashPtDefend(
                    defense_category=category,
                    season=season,
                    per_mode_simple='PerGame',
                    league_id='00',
                )
                time.sleep(2)
                df = result.get_data_frames()[0]
                if not df.empty:
                    logger.info(f"  Got {len(df)} rows for {category}")
                    for _, row in df.iterrows():
                        team_abbr = row.get('TEAM_ABBREVIATION', '')
                        if not team_abbr:
                            continue
                        if team_abbr not in positions_data:
                            positions_data[team_abbr] = {}

                        pos_map = {'Guard': 'G', 'Forward': 'F', 'Center': 'C'}
                        pos = pos_map.get(category, category[0])
                        d_fgm = float(row.get('D_FGM', 0))
                        d_fga = float(row.get('D_FGA', 1))
                        d_fg_pct = float(row.get('D_FG_PCT', 0.45))
                        freq = float(row.get('FREQ', 0))

                        positions_data[team_abbr][pos] = {
                            'pts_allowed': round(d_fgm * 2.2, 1),  # Approximate
                            'reb_allowed': 5.0,  # Will refine
                            'ast_allowed': 3.0,  # Will refine
                            'fg_pct_allowed': round(d_fg_pct, 4),
                        }
            except Exception as e:
                logger.warning(f"  LeagueDashPtDefend {category} failed: {e}")

    except ImportError:
        logger.warning("leaguedashptdefend not available")

    # If API data is sparse, generate estimates from team_defense
    if len(positions_data) < 20:
        logger.info("Supplementing with estimated positional defense data...")
        positions_data = supplement_with_estimates(positions_data)

    return positions_data


def supplement_with_estimates(existing_data):
    """Generate estimated positional defense from team defense totals."""
    conn = get_db()
    if not conn:
        return existing_data

    cur = conn.cursor()
    cur.execute("""
        SELECT team_abbr, def_rating, opp_pts_allowed, opp_reb_allowed, opp_ast_allowed,
               opp_3pt_pct_allowed
        FROM team_defense WHERE season = %s
    """, (get_season(),))

    rows = cur.fetchall()
    cur.close()
    conn.close()

    if not rows:
        return existing_data

    # League averages for position splits
    # Guards ~45% of scoring, Forwards ~35%, Centers ~20%
    POS_SPLITS = {
        'G': {'pts_pct': 0.45, 'reb_pct': 0.20, 'ast_pct': 0.55},
        'F': {'pts_pct': 0.35, 'reb_pct': 0.40, 'ast_pct': 0.30},
        'C': {'pts_pct': 0.20, 'reb_pct': 0.40, 'ast_pct': 0.15},
    }

    for team_abbr, def_rtg, opp_pts, opp_reb, opp_ast, opp_3pct in rows:
        if team_abbr in existing_data and len(existing_data[team_abbr]) >= 3:
            continue  # Already have good data

        if team_abbr not in existing_data:
            existing_data[team_abbr] = {}

        # Estimate league avg is ~112 pts, adjust based on team's defensive rating
        factor = (def_rtg / 112.0) if def_rtg and def_rtg > 0 else 1.0
        opp_pts = opp_pts or 112.0
        opp_reb = opp_reb or 44.0
        opp_ast = opp_ast or 25.0
        opp_3pct = opp_3pct or 0.36

        for pos, splits in POS_SPLITS.items():
            if pos not in existing_data[team_abbr]:
                existing_data[team_abbr][pos] = {
                    'pts_allowed': round(opp_pts * splits['pts_pct'] / 2.5, 1),
                    'reb_allowed': round(opp_reb * splits['reb_pct'] / 2.5, 1),
                    'ast_allowed': round(opp_ast * splits['ast_pct'] / 2.5, 1),
                    'fg_pct_allowed': round(opp_3pct * factor, 4),
                }

    return existing_data


def store_team_defense(conn, teams, season):
    """Upsert team defense ratings."""
    if not teams:
        return 0
    cur = conn.cursor()
    stored = 0
    try:
        for t in teams:
            cur.execute("""
                INSERT INTO team_defense (team_id, team_abbr, season, def_rating, pace,
                    opp_pts_allowed, opp_reb_allowed, opp_ast_allowed, opp_3pt_pct_allowed, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (team_id) DO UPDATE SET
                    def_rating = EXCLUDED.def_rating,
                    pace = EXCLUDED.pace,
                    opp_pts_allowed = EXCLUDED.opp_pts_allowed,
                    opp_reb_allowed = EXCLUDED.opp_reb_allowed,
                    opp_ast_allowed = EXCLUDED.opp_ast_allowed,
                    opp_3pt_pct_allowed = EXCLUDED.opp_3pt_pct_allowed,
                    updated_at = NOW()
            """, (t['team_id'], t['team_abbr'], season,
                  t['def_rating'], t['pace'],
                  t['opp_pts_allowed'], t['opp_reb_allowed'],
                  t['opp_ast_allowed'], t['opp_3pt_pct_allowed']))
            stored += 1
        conn.commit()
        logger.info(f"Stored {stored} team defense ratings")
    except Exception as e:
        conn.rollback()
        logger.error(f"Store team_defense failed: {e}")
    finally:
        cur.close()
    return stored


def store_defense_by_position(conn, positions_data, season):
    """Upsert positional defense data."""
    if not positions_data:
        return 0
    cur = conn.cursor()
    stored = 0
    try:
        for team_abbr, positions in positions_data.items():
            for pos, stats in positions.items():
                cur.execute("""
                    INSERT INTO team_defense_by_position
                        (team_id, position, pts_allowed, reb_allowed, ast_allowed,
                         fg_pct_allowed, season, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (team_id, position, season) DO UPDATE SET
                        pts_allowed = EXCLUDED.pts_allowed,
                        reb_allowed = EXCLUDED.reb_allowed,
                        ast_allowed = EXCLUDED.ast_allowed,
                        fg_pct_allowed = EXCLUDED.fg_pct_allowed,
                        updated_at = NOW()
                """, (team_abbr, pos,
                      stats.get('pts_allowed'), stats.get('reb_allowed'),
                      stats.get('ast_allowed'), stats.get('fg_pct_allowed'),
                      season))
                stored += 1
        conn.commit()
        logger.info(f"Stored {stored} positional defense entries")
    except Exception as e:
        conn.rollback()
        logger.error(f"Store defense_by_position failed: {e}")
    finally:
        cur.close()
    return stored


def main():
    season = get_season()
    logger.info(f"=== Fetching defensive stats for {season} ===")

    # Fetch team defense ratings
    teams = fetch_team_defense_ratings(season)

    # Fetch positional defense
    pos_data = fetch_defense_by_position(season)

    # Store
    conn = get_db()
    if conn:
        if teams:
            store_team_defense(conn, teams, season)
        if pos_data:
            store_defense_by_position(conn, pos_data, season)
        conn.close()
    else:
        logger.error("Could not connect to database")

    logger.info("=== Done ===")


if __name__ == '__main__':
    main()
