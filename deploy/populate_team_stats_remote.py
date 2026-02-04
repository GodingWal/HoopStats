import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

script_content = """
import os
import sys
import pandas as pd
from sqlalchemy import create_engine, text
from nba_api.stats.endpoints import leaguedashteamstats
from nba_api.stats.static import teams
from dotenv import load_dotenv

# Load env
load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")

if not DB_URL:
    print("Error: DATABASE_URL not found")
    sys.exit(1)

# Fix SQLAlchemy 1.4+ deprecation of postgres://
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

def fetch_and_save_team_stats(season='2024-25'):
    print(f"Fetching team stats for {season}...")
    try:
        # 1. Advanced for Pace/DefRating
        df_adv = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense='Advanced',
            per_mode_detailed='PerGame'
        ).get_data_frames()[0]
        
        # 2. Opponent for allowed stats
        df_opp = leaguedashteamstats.LeagueDashTeamStats(
            season=season,
            measure_type_detailed_defense='Opponent',
            per_mode_detailed='PerGame'
        ).get_data_frames()[0]

        # Merge on TEAM_ID
        df = pd.merge(df_adv, df_opp[['TEAM_ID', 'OPP_PTS', 'OPP_REB', 'OPP_AST', 'OPP_FG3_PCT']], on='TEAM_ID')
        
        print("Columns:", df.columns.tolist())
        
    except Exception as e:
        print(f"Error fetching stats: {e}")
        return

    print(f"Processing {len(df)} teams...")
    
    # Create mapping
    nba_teams = teams.get_teams()
    id_to_abbr = {t['id']: t['abbreviation'] for t in nba_teams}

    with engine.connect() as conn:
        for _, row in df.iterrows():
            team_id = row['TEAM_ID']
            abbr = id_to_abbr.get(team_id, row.get('TEAM_NAME', 'UNK')[:3].upper())
            
            # Safety check columns
            pace = row.get('PACE', row.get('E_PACE', 100.0))
            def_rtg = row.get('DEF_RATING', row.get('E_DEF_RATING', 110.0))
            
            # Opponent allowed stats
            opp_pts = row.get('OPP_PTS', 110.0)
            opp_reb = row.get('OPP_REB', 44.0)
            opp_ast = row.get('OPP_AST', 25.0)
            opp_3pt = row.get('OPP_FG3_PCT', 0.36)

            sql = text(\"""
                INSERT INTO team_defense (team_id, team_abbr, season, def_rating, pace, opp_pts_allowed, opp_reb_allowed, opp_ast_allowed, opp_3pt_pct_allowed, updated_at)
                VALUES (:tid, :abbr, :season, :drtg, :pace, :opp_pts, :opp_reb, :opp_ast, :opp_3pt, NOW())
                ON CONFLICT (team_id) DO UPDATE SET
                    def_rating = EXCLUDED.def_rating,
                    pace = EXCLUDED.pace,
                    opp_pts_allowed = EXCLUDED.opp_pts_allowed,
                    opp_reb_allowed = EXCLUDED.opp_reb_allowed,
                    opp_ast_allowed = EXCLUDED.opp_ast_allowed,
                    opp_3pt_pct_allowed = EXCLUDED.opp_3pt_pct_allowed,
                    updated_at = NOW();
            \""")
            
            conn.execute(sql, {
                'tid': team_id,
                'abbr': abbr,
                'season': season,
                'drtg': def_rtg,
                'pace': pace,
                'opp_pts': opp_pts,
                'opp_reb': opp_reb,
                'opp_ast': opp_ast,
                'opp_3pt': opp_3pt
            })
            
        conn.commit()
    print("Success.")

if __name__ == "__main__":
    fetch_and_save_team_stats()
"""

# Save script to remote
sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/populate_team_stats.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Script uploaded. Installing requirements if needed...")
# Add verbose verify
cmd_req = "python3 -m pip install sqlalchemy pandas nba_api python-dotenv psycopg2-binary --break-system-packages || echo 'Pip failed'"
stdin, stdout, stderr = client.exec_command(cmd_req)
out = stdout.read().decode()
err = stderr.read().decode()
print(f"Pip Out: {out}")
print(f"Pip Err: {err}")

print("Running script...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/populate_team_stats.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
