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

# Load env
load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")

if not DB_URL:
    print("Error: DATABASE_URL not found")
    sys.exit(1)

if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

def populate_referees(days=30):
    start_date = datetime.now() - timedelta(days=days)
    dates = [start_date + timedelta(days=x) for x in range(days + 1)]
    
    print(f"Populating referees for last {days} days...")
    
    with engine.connect() as conn:
        for d in dates:
            date_str = d.strftime('%Y-%m-%d')
            print(f"Processing {date_str}...")
            
            try:
                # Get games for date
                try:
                    board = scoreboardv2.ScoreboardV2(game_date=date_str).get_data_frames()[0]
                except Exception as e:
                    print(f"  Scoreboard error: {e}")
                    continue

                if board.empty:
                    continue
                    
                game_ids = board['GAME_ID'].unique().tolist()
                
                for gid in game_ids:
                    try:
                        # Check if we already have refs for this game
                        check_sql = text("SELECT COUNT(*) FROM game_referees WHERE game_id = :gid")
                        count = conn.execute(check_sql, {'gid': gid}).scalar()
                        if count > 0:
                            # print(f"  Skipping {gid} (already exists)")
                            continue
                            
                        # Fetch summary
                        time.sleep(0.6) # Rate limit pre-emptive
                        summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=gid).get_data_frames()
                        if len(summary) < 3:
                            continue
                            
                        # DataFrame 2 is officials
                        officials = summary[2]
                        if officials.empty:
                            print(f"  No officials for {gid}")
                            continue

                        print(f"  Saving refs for {gid}")
                        
                        for _, row in officials.iterrows():
                            ref_id = row['OFFICIAL_ID']
                            first = row['FIRST_NAME']
                            last = row['LAST_NAME']
                            jersey = row['JERSEY_NUM']
                            
                            # 1. Upsert Referee
                            upsert_ref = text(\"\"\"
                                INSERT INTO referees (id, first_name, last_name, jersey_number)
                                VALUES (:rid, :fn, :ln, :jn)
                                ON CONFLICT (id) DO UPDATE SET
                                    first_name = EXCLUDED.first_name,
                                    last_name = EXCLUDED.last_name,
                                    jersey_number = EXCLUDED.jersey_number
                            \"\"\")
                            conn.execute(upsert_ref, {
                                'rid': ref_id,
                                'fn': first,
                                'ln': last,
                                'jn': jersey
                            })
                            
                            # 2. Insert Assignment
                            insert_assign = text(\"\"\"
                                INSERT INTO game_referees (game_id, referee_id)
                                VALUES (:gid, :rid)
                                ON CONFLICT (game_id, referee_id) DO NOTHING
                            \"\"\")
                            conn.execute(insert_assign, {'gid': gid, 'rid': ref_id})
                            
                        conn.commit()
                        
                    except Exception as e:
                        print(f"Error game {gid}: {e}")
                        conn.rollback()
                        
            except Exception as e:
                print(f"Error date {date_str}: {e}")
                
    print("Done.")

if __name__ == "__main__":
    populate_referees()
"""

# Upload script
sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/populate_referees.py"
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
