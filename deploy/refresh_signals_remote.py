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

# Create a script to run backtest for last 3 days to populate signals
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
# BacktestEngine expects a raw DBAPI connection with .cursor()
conn = engine.raw_connection()

print("Initializing Backtest Engine...")
bt = BacktestEngine(conn)

print("Running Backtest for last 3 days to populate signals...")
# Run for all available stats
stats_to_test = [
    'Points', 'Rebounds', 'Assists', '3-PT Made', 'Pts+Rebs+Asts', 
    'Pts+Rebs', 'Pts+Asts', 'Rebs+Asts', 'Steals', 'Blocks', 
    'Turnovers', 'Fantasy Score', 'Blks+Stls', 'Dunks', 'FG Made'
]
for stat in stats_to_test:
    print(f"  Analysing {stat}...")
    try:
        results = bt.run(days=3, stat_type=stat)
        bt.save_to_db(results)
        print(f"    Saved {results.total_games} games. Accuracy: {results.overall_accuracy:.1%}")
    except Exception as e:
        print(f"    Error: {e}")

conn.close()
"""

# Save script to remote
sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Script uploaded. Running refresh...")

# Install scipy
cmd_req = "python3 -m pip install scipy --break-system-packages"
stdin, stdout, stderr = client.exec_command(cmd_req)
print(f"Pip: {stdout.read().decode()}")

cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/refresh_signals.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
