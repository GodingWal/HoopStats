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
    print("--- Movement by Stat Type ---")
    df = pd.read_sql(\"\"\"
        SELECT stat_type, COUNT(*) as count
        FROM prizepicks_daily_lines
        WHERE closing_line != opening_line
        AND game_date >= NOW() - INTERVAL '3 days'
        GROUP BY stat_type
    \"\"\", conn)
    print(df)
"""

sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/check_movement_stats.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = f"python3 {remote_path}"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
