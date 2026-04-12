#!/usr/bin/env python3
"""
Populate team_defense_by_position table.
Uses approximate data - will be refined when NBA API endpoint works.
"""
import os, sys, json, logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL

import psycopg2


def ensure_table(conn):
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS team_defense_by_position (
            id SERIAL PRIMARY KEY,
            team_id VARCHAR(10) NOT NULL,
            position VARCHAR(5) NOT NULL,
            pts_allowed NUMERIC,
            reb_allowed NUMERIC,
            ast_allowed NUMERIC,
            fg_pct_allowed NUMERIC,
            season VARCHAR(10) DEFAULT '2025-26',
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(team_id, position, season)
        )
    """)
    conn.commit()
    cur.close()

def get_positional_defense_data():
    """Try NBA API first, fall back to estimates from team def ratings."""
    try:
        from nba_api.stats.endpoints import leaguedashptdefend
        import time
        
        positions = {'Guard': 'PG', 'Forward': 'SF', 'Center': 'C'}
        # This endpoint may not work reliably
        data = {}
        for pos_name, pos_abbr in positions.items():
            try:
                result = leaguedashptdefend.LeagueDashPtDefend(
                    defense_category=pos_name,
                    season='2025-26',
                    per_mode_simple='PerGame'
                )
                time.sleep(1.5)
                df = result.get_data_frames()[0]
                for _, row in df.iterrows():
                    team = row.get('TEAM_ABBREVIATION', '')
                    if team not in data:
                        data[team] = {}
                    data[team][pos_abbr] = {
                        'pts_allowed': float(row.get('D_FG_PCT', 0.45) * 20),
                        'reb_allowed': 5.0,
                        'ast_allowed': 3.0,
                        'fg_pct_allowed': float(row.get('D_FG_PCT', 0.45)),
                    }
            except Exception as e:
                logger.warning(f"NBA API failed for {pos_name}: {e}")
        
        if data:
            return data
    except ImportError:
        pass
    
    return get_fallback_positional_defense()

def get_fallback_positional_defense():
    """Generate approximate positional defense data from team ratings."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("SELECT team_id, def_rating FROM team_stats WHERE season = '2025-26'")
    teams = dict(cur.fetchall())
    cur.close()
    conn.close()
    
    if not teams:
        logger.error("No team_stats data - run populate_team_stats.py first")
        return {}
    
    # League avg def rating ~112
    league_avg = sum(float(v) for v in teams.values()) / len(teams) if teams else 112.0
    
    # Base points allowed by position (league average)
    base_pts = {'PG': 24.5, 'SG': 22.8, 'SF': 20.2, 'PF': 19.5, 'C': 18.2}
    base_reb = {'PG': 4.2, 'SG': 4.5, 'SF': 6.8, 'PF': 8.2, 'C': 10.5}
    base_ast = {'PG': 7.5, 'SG': 4.2, 'SF': 3.5, 'PF': 3.0, 'C': 2.8}
    
    data = {}
    for team_id, def_rtg in teams.items():
        def_rtg = float(def_rtg)
        # Scale factor: better defense (lower rating) = fewer stats allowed
        scale = def_rtg / league_avg
        data[team_id] = {}
        for pos in ['PG', 'SG', 'SF', 'PF', 'C']:
            data[team_id][pos] = {
                'pts_allowed': round(base_pts[pos] * scale, 1),
                'reb_allowed': round(base_reb[pos] * scale, 1),
                'ast_allowed': round(base_ast[pos] * scale, 1),
                'fg_pct_allowed': round(0.46 * scale, 3),
            }
    
    return data

def save_to_db(data):
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    ensure_table(conn)
    
    count = 0
    for team_id, positions in data.items():
        for pos, stats in positions.items():
            cur.execute("""
                INSERT INTO team_defense_by_position (team_id, position, pts_allowed, reb_allowed, ast_allowed, fg_pct_allowed, season, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, '2025-26', NOW())
                ON CONFLICT (team_id, position, season) DO UPDATE SET
                    pts_allowed = EXCLUDED.pts_allowed,
                    reb_allowed = EXCLUDED.reb_allowed,
                    ast_allowed = EXCLUDED.ast_allowed,
                    fg_pct_allowed = EXCLUDED.fg_pct_allowed,
                    updated_at = NOW()
            """, (team_id, pos, stats['pts_allowed'], stats['reb_allowed'],
                  stats['ast_allowed'], stats['fg_pct_allowed']))
            count += 1
    
    conn.commit()
    cur.close()
    conn.close()
    logger.info(f"Saved {count} positional defense records")

if __name__ == '__main__':
    data = get_positional_defense_data()
    if data:
        save_to_db(data)
    else:
        logger.error("No positional defense data to save")
