import paramiko
import sys
import time

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
from nba_api.stats.static import teams
from nba_api.stats.endpoints import commonteamroster
from dotenv import load_dotenv
import os
import sys

# Load env since we are running as root/script
load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")

if not DB_URL:
    print("Error: DATABASE_URL not found")
    sys.exit(1)

# Fix SQLAlchemy 1.4+ deprecation of postgres://
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

def populate_positions():
    print("Fetching NBA teams...")
    nba_teams = teams.get_teams()
    
    updates = []
    
    for team in nba_teams:
        tid = team['id']
        abbr = team['abbreviation']
        print(f"Fetching roster for {abbr} ({tid})...")
        
        try:
            roster = commonteamroster.CommonTeamRoster(team_id=tid, season='2024-25').get_data_frames()[0]
            
            for _, row in roster.iterrows():
                # Extract PlayerID
                if 'PLAYER_ID' in row:
                    pid = row['PLAYER_ID']
                elif 'PLAYER_ID' in roster.columns:
                    pid = row['PLAYER_ID']
                else:
                    if len(updates) == 0:
                        print(f"Columns: {roster.columns.tolist()}")
                    continue
                
                pos = row['POSITION']
                pname = row['PLAYER']
                
                updates.append({
                    'pid': pid,
                    'pos': pos,
                    'name': pname
                })
                
        except Exception as e:
            print(f"Error fetching {abbr}: {e}")
        
        time.sleep(0.6) # Rate limit safety
    
    print(f"Found {len(updates)} players. Updating DB...")
    
    with engine.connect() as conn:
        for p in updates:
            # Upsert position by exact name match
            sql = text(\"\"\"
                UPDATE players 
                SET position = :pos 
                WHERE player_name = :name
            \"\"\")
            result = conn.execute(sql, {'pos': p['pos'], 'name': p['name']})
        
        conn.commit()
    
    print("Done.")

if __name__ == "__main__":
    populate_positions()
"""

# Upload script
sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/populate_positions.py"
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
