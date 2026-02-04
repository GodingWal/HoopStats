import paramiko
import sys
import json
from datetime import datetime

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Inspecting projection_logs table...")
python_code = """
import os
import psycopg2
import json

conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

# Check latest projections
cur.execute('''
    SELECT player_name, game_date, projected_value, captured_at
    FROM projection_logs
    ORDER BY captured_at DESC
    LIMIT 5
''')
rows = cur.fetchall()
print('Latest Projections:')
for row in rows:
    print(f'{row[0]} ({row[1]}): Projected={row[2]} (Captured: {row[3]})')

# Check count of non-zero projections today
cur.execute('''
    SELECT COUNT(*) FROM projection_logs
    WHERE game_date = CURRENT_DATE
    AND projected_value > 0
''')
count = cur.fetchone()[0]
print(f'Non-zero projections for today: {count}')

conn.close()
"""

cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} -c "{python_code}"
"""

stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode().strip())
err = stderr.read().decode().strip()
if err:
    print("Error:", err)

client.close()
