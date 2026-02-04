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
from nba_api.stats.endpoints import scoreboardv2, boxscoresummaryv2
from dotenv import load_dotenv
import os
import sys
from datetime import datetime, timedelta

print("Starting population...")

load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

print("Connecting to DB...")
engine = create_engine(DB_URL)

def populate_referees(days=3):
    start_date = datetime.now() - timedelta(days=days)
    dates = [start_date + timedelta(days=x) for x in range(days + 1)]
    
    with engine.connect() as conn:
        for d in dates:
            date_str = d.strftime('%Y-%m-%d')
            print(f"Processing {date_str}...")
            
            try:
                print("  Fetching Scoreboard...")
                try:
                    board = scoreboardv2.ScoreboardV2(game_date=date_str).get_data_frames()[0]
                except Exception as e:
                    print(f"  Scoreboard API Error: {e}")
                    continue

                if board.empty:
                    print("  Board empty")
                    continue
                
                try:
                    line_score = scoreboardv2.ScoreboardV2(game_date=date_str).get_data_frames()[1]
                    team_map = {}
                    for _, row in line_score.iterrows():
                        team_map[row['TEAM_ID']] = row['TEAM_ABBREVIATION']
                except Exception as e:
                    print(f"  LineScore error: {e}")
                    continue

                for _, row in board.iterrows():
                    gid = row['GAME_ID']
                    home_id = row['HOME_TEAM_ID']
                    visit_id = row['VISITOR_TEAM_ID']
                    
                    home_abbr = team_map.get(home_id, 'UNK')
                    visit_abbr = team_map.get(visit_id, 'UNK')
                    
                    # print(f"    Game {gid}: {visit_abbr} @ {home_abbr}")
                    
                    upsert_game = text(\"\"\"
                        INSERT INTO games (game_id, game_date, home_team, visitor_team)
                        VALUES (:gid, :date, :home, :visit)
                        ON CONFLICT (game_id) DO UPDATE SET
                            game_date = EXCLUDED.game_date,
                            home_team = EXCLUDED.home_team,
                            visitor_team = EXCLUDED.visitor_team
                    \"\"\")
                    conn.execute(upsert_game, {
                        'gid': gid,
                        'date': date_str,
                        'home': home_abbr,
                        'visit': visit_abbr
                    })

                    check_sql = text("SELECT COUNT(*) FROM game_referees WHERE game_id = :gid")
                    count = conn.execute(check_sql, {'gid': gid}).scalar()
                    if count > 0:
                        # print("      Refs exist")
                        continue
                        
                    time.sleep(0.6)
                    try:
                        summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=gid).get_data_frames()
                        if len(summary) < 3:
                            continue
                        
                        officials = summary[2]
                        if officials.empty:
                            continue

                        print(f"      Saving {len(officials)} refs for {visit_abbr}@{home_abbr}...")
                        
                        for _, r_row in officials.iterrows():
                            ref_id = r_row['OFFICIAL_ID']
                            first = r_row['FIRST_NAME']
                            last = r_row['LAST_NAME']
                            jersey = r_row['JERSEY_NUM']
                            
                            conn.execute(text(\"\"\"
                                INSERT INTO referees (id, first_name, last_name, jersey_number)
                                VALUES (:rid, :fn, :ln, :jn)
                                ON CONFLICT (id) DO NOTHING
                            \"\"\"), {'rid': ref_id, 'fn': first, 'ln': last, 'jn': jersey})
                            
                            conn.execute(text(\"\"\"
                                INSERT INTO game_referees (game_id, referee_id)
                                VALUES (:gid, :rid)
                                ON CONFLICT (game_id, referee_id) DO NOTHING
                            \"\"\"), {'gid': gid, 'rid': ref_id})
                            
                        conn.commit()
                    except Exception as e:
                        print(f"      BoxScore Error {gid}: {e}")

            except Exception as e:
                print(f"Error date {date_str}: {e}")
                
    print("Done.")

if __name__ == "__main__":
    populate_referees()
"""

# Upload script
sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/populate_referees_verbose.py"
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
