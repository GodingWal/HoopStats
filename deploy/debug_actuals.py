import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

print(f"Connecting to {HOST}...")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
print("Connected!")

# Run actuals for all dates with data
print("\nRunning actuals population for all dates...")

# Create a script to run actuals for each date
script = '''
import os
import sys
sys.path.insert(0, '/var/www/hoopstats/server/nba-prop-model')

import psycopg2
from datetime import datetime, timedelta

db_url = os.environ.get('DATABASE_URL')
if not db_url:
    print("No DATABASE_URL")
    sys.exit(1)

conn = psycopg2.connect(db_url)
cursor = conn.cursor()

# Get all dates with data
cursor.execute("SELECT DISTINCT game_date FROM prizepicks_daily_lines WHERE actual_value IS NULL ORDER BY game_date")
dates = [row[0] for row in cursor.fetchall()]
print(f"Found {len(dates)} dates needing actuals: {dates}")

# For now just report - the actuals job should handle this
cursor.close()
conn.close()
'''

cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} -c "{script}"
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Check what the actuals job actually does
print("\nChecking cron_jobs.py actuals logic...")
stdin, stdout, stderr = client.exec_command(f"head -100 {MODEL_DIR}/scripts/cron_jobs.py", timeout=10)
print(stdout.read().decode().strip())

client.close()
print("\nDone!")
