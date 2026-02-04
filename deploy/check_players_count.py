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

# Check players table
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} -c "
import os
import psycopg2
from psycopg2.extras import RealDictCursor

conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()
cur.execute('SELECT COUNT(*) as total, COUNT(season_averages) as with_avgs FROM players')
row = cur.fetchone()
print(f'Players: {{row[0]}} total, {{row[1]}} with averages')
"
"""
stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

client.close()
