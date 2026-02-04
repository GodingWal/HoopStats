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
from sqlalchemy import create_engine, text
from dotenv import load_dotenv
import os
import pandas as pd

load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

with engine.connect() as conn:
    print("--- Referee Coverage ---")
    # Get all refs assigned to games
    refs_df = pd.read_sql(\"\"\"
        SELECT DISTINCT r.first_name || ' ' || r.last_name as name
        FROM game_referees gr
        JOIN referees r ON gr.referee_id = r.id
    \"\"\", conn)
    
    found_refs = set(refs_df['name'].tolist())
    print(f"Total unique refs in DB: {len(found_refs)}")
    
    # Hardcoded list from referee.py
    REFEREE_TENDENCIES = {
        "Tony Brothers", "Scott Foster", "Ed Malloy", "Josh Tiven", "Sean Wright",
        "James Williams", "Kane Fitzgerald", "Michael Smith", "Rodney Mott",
        "Curtis Blair", "Ben Taylor", "Karl Lane", "JB DeRosa"
    }
    
    overlap = found_refs.intersection(REFEREE_TENDENCIES)
    print(f"Overlap with hardcoded list: {len(overlap)}")
    print(f"Matched: {overlap}")
    
    print("\\n--- Line Movement Coverage ---")
    # Check closing lines
    lines_df = pd.read_sql(\"\"\"
        SELECT 
            COUNT(*) as total,
            COUNT(closing_line) as has_closing,
            SUM(CASE WHEN closing_line != opening_line THEN 1 ELSE 0 END) as moved
        FROM prizepicks_daily_lines
        WHERE game_date >= NOW() - INTERVAL '3 days'
    \"\"\", conn)
    print(lines_df)
    
    print("\\n--- Checking History Logic ---")
    # Check if we have history for games without closing line
    hist_check = pd.read_sql(\"\"\"
        SELECT COUNT(DISTINCT plm.id) as movements
        FROM prizepicks_line_movements plm
        WHERE plm.detected_at >= NOW() - INTERVAL '3 days'
    \"\"\", conn)
    print(hist_check)

"""

sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/check_signal_coverage.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Running coverage check...")
cmd_run = f"python3 {remote_path}"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
