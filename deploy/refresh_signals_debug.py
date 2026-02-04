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

# Ensure project root is in path
sys.path.append("/var/www/hoopstats/server/nba-prop-model")

from dotenv import load_dotenv
from sqlalchemy import create_engine
from src.evaluation.backtest_engine import BacktestEngine
import logging

# Setup basic logging
logging.basicConfig(level=logging.INFO)

load_dotenv("/var/www/hoopstats/.env")
DB_URL = os.getenv("DATABASE_URL")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

print("Connecting to DB...")
engine = create_engine(DB_URL)
conn = engine.raw_connection()

print("Initializing Backtest Engine...")
bt = BacktestEngine(conn)

print("Running Backtest for last 3 days to populate signals...")
for stat in ['Points', 'Rebounds', 'Assists']:
    print(f"  Analysing {stat}...")
    try:
        results = bt.run(days=3, stat_type=stat)
        
        # Debug signals
        print("    Signal Breakdown:")
        for name, acc in results.signal_accuracy.items():
            occurrences = acc.correct + acc.incorrect
            if occurrences > 0:
                print(f"      {name}: {occurrences} occ ({acc.accuracy:.1%})")
            else:
                # print(f"      {name}: 0 occ")
                pass
                
        bt.save_to_db(results)
        print(f"    Saved {results.total_games} games. Overall Accuracy: {results.overall_accuracy:.1%}")
    except Exception as e:
        print(f"    Error: {e}")

conn.close()
"""

sftp = client.open_sftp()
remote_path = "/var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals_debug.py"
with sftp.file(remote_path, "w") as f:
    f.write(script_content)
sftp.close()

print("Script uploaded. Running refresh debug...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals_debug.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
