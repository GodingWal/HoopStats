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
    print("--- B2B Check ---")
    # Find teams with games on consecutive days
    b2b_df = pd.read_sql(\"\"\"
        SELECT t1.team, t1.game_date as date1, t2.game_date as date2
        FROM prizepicks_daily_lines t1
        JOIN prizepicks_daily_lines t2 ON t1.team = t2.team 
            AND t2.game_date = t1.game_date - INTERVAL '1 day'
        WHERE t1.game_date >= '2026-01-30'
        GROUP BY t1.team, t1.game_date, t2.game_date
        LIMIT 10
    \"\"\", conn)
    print(b2b_df)
    
    print("\\n--- Blowout Data Check ---")
    # Check if we have spread info
    # Assuming 'odds_spread' or similar column, or maybe it uses implied spread
    # Let's check columns of prizepicks_daily_lines
    cols = pd.read_sql("SELECT * FROM prizepicks_daily_lines LIMIT 1", conn).columns.tolist()
    print(f"Columns: {cols}")
"""

sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/check_b2b_blowout.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = f"python3 {remote_path}"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
