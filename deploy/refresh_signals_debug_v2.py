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

sys.path.append("/var/www/hoopstats/server/nba-prop-model")

from dotenv import load_dotenv
from sqlalchemy import create_engine
from src.evaluation.backtest_engine import BacktestEngine
import logging

logging.basicConfig(level=logging.ERROR) # Less noise

load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

print("Connecting to DB...")
engine = create_engine(DB_URL)
conn = engine.raw_connection()

print("Initializing Backtest Engine...")
bt = BacktestEngine(conn)

print("Running Backtest...")
# Only test 'Points' to see details
for stat in ['Points']:
    print(f"  Analysing {stat}...")
    try:
        results = bt.run(days=3, stat_type=stat)
        print(results.get_summary_table())
        
        # Save? No, just debug
        # bt.save_to_db(results)
    except Exception as e:
        print(f"    Error: {e}")

conn.close()
"""

sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals_debug_v2.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Script uploaded. Running refresh debug...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals_debug_v2.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
