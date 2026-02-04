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
import pandas as pd
import time
from sqlalchemy import create_engine, text
from nba_api.stats.endpoints import scoreboardv2, boxscoresummaryv3
from dotenv import load_dotenv
import os
import sys
from datetime import datetime, timedelta

print("Starting robust population V4...")
sys.stdout.reconfigure(line_buffering=True)

load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

def populate_referees(days=3):
    start_date = datetime.now() - timedelta(days=days)
    dates = [start_date + timedelta(days=x) for x in range(days + 2)]
    
    with engine.connect() as conn:
        for d in dates:
            date_str = d.strftime('%Y-%m-%d')
            print(f"Processing {date_str}...")
            
            try:
                try:
                    board = scoreboardv2.ScoreboardV2(game_date=date_str).get_data_frames()[0]
                except Exception as e:
                    print(f"  Scoreboard API Error: {e}")
                    continue

                if board.empty:
                    print("  Board empty")
                    continue
                
                game_ids = board['GAME_ID'].unique().tolist()
                print(f"  Found {len(game_ids)} games")
                
                for gid in game_ids:
                    # Skip check to ensure update
                    time.sleep(0.6)
                    try:
                        dfs = boxscoresummaryv3.BoxScoreSummaryV3(game_id=gid).get_data_frames()
                        
                        # Dynamic DF finding
                        meta, officials, teams = pd.DataFrame(), pd.DataFrame(), pd.DataFrame()
                        
                        for i, df in enumerate(dfs):
                            cols = set(df.columns)
                            if 'homeTeamId' in cols and 'awayTeamId' in cols:
                                meta = df
                            elif ('firstName' in cols and 'jerseyNum' in cols) or ('personId' in cols and 'jerseyNum' in cols):
                                officials = df
                            elif 'teamTricode' in cols and 'teamName' in cols:
                                teams = df
                                
                        if meta.empty:
                            # print(f"    {gid}: No metadata")
                            continue
                        if officials.empty:
                            print(f"    {gid}: No officials found")
                            continue
                        if teams.empty:
                            print(f"    {gid}: No teams info")
                            continue
                            
                        home_id = meta.iloc[0]['homeTeamId']
                        away_id = meta.iloc[0]['awayTeamId']
                        
                        tricode_map = {}
                        for _, row in teams.iterrows():
                            tricode_map[row['teamId']] = row['teamTricode']
                            
                        home_abbr = tricode_map.get(home_id, 'UNK')
                        vis_abbr = tricode_map.get(away_id, 'UNK')
                        
                        print(f"    Saving {vis_abbr} @ {home_abbr} ({len(officials)} refs)...")
                        
                        # Upsert Game
                        conn.execute(text(\"\"\"
                            INSERT INTO games (game_id, game_date, home_team, visitor_team)
                            VALUES (:gid, :date, :home, :visit)
                            ON CONFLICT (game_id) DO UPDATE SET
                                game_date = EXCLUDED.game_date,
                                home_team = EXCLUDED.home_team,
                                visitor_team = EXCLUDED.visitor_team
                        \"\"\"), {
                            'gid': gid, 'date': date_str,
                            'home': home_abbr, 'visit': vis_abbr
                        })
                        
                        # Upsert Refs
                        for _, row in officials.iterrows():
                            rid = row.get('personId')
                            first = row.get('firstName')
                            last = row.get('familyName')
                            jersey = row.get('jerseyNum')
                            
                            conn.execute(text(\"\"\"
                                INSERT INTO referees (id, first_name, last_name, jersey_number)
                                VALUES (:rid, :fn, :ln, :jn)
                                ON CONFLICT (id) DO NOTHING
                            \"\"\"), {'rid': rid, 'fn': first, 'ln': last, 'jn': jersey})
                            
                            conn.execute(text(\"\"\"
                                INSERT INTO game_referees (game_id, referee_id)
                                VALUES (:gid, :rid)
                                ON CONFLICT (game_id, referee_id) DO NOTHING
                            \"\"\"), {'gid': gid, 'rid': rid})
                            
                        conn.commit()
                        
                    except Exception as e:
                        print(f"    Error {gid}: {e}")
                        conn.rollback()

            except Exception as e:
                print(f"Error date {date_str}: {e}")
                
    print("Done.")

if __name__ == "__main__":
    populate_referees()
"""

# Upload script
sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/populate_referees_v4_robust.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Script uploaded. Running...")
cmd_run = f"python3 {remote_path}"
stdin, stdout, stderr = client.exec_command(cmd_run)

# Stream output
while True:
    line = stdout.readline()
    if not line:
        break
    print(line.strip())

err = stderr.read().decode()
if err:
    print(f"Stderr: {err}")

client.close()
