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

# Check join rate
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} -c "
import os
import psycopg2
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

# Check distinct players in lines
cur.execute('SELECT COUNT(DISTINCT player_name) FROM prizepicks_daily_lines')
total_line_players = cur.fetchone()[0]

# Check distinct players in players table (Correct column: player_name)
cur.execute('SELECT COUNT(DISTINCT player_name) FROM players')
total_db_players = cur.fetchone()[0]

# Check overlap (case-insensitive)
cur.execute('''
    SELECT COUNT(DISTINCT pdl.player_name)
    FROM prizepicks_daily_lines pdl
    JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
''')
matched_players = cur.fetchone()[0]

print(f'Players in Lines: {{total_line_players}}')
print(f'Players in DB: {{total_db_players}}')
print(f'Matched Players: {{matched_players}}')
if total_line_players > 0:
    print(f'Match Rate: {{matched_players/total_line_players*100:.1f}}%')
else:
    print('Match Rate: N/A')

# List some mismatches
if matched_players < total_line_players:
    cur.execute('''
        SELECT DISTINCT pdl.player_name
        FROM prizepicks_daily_lines pdl
        LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
        WHERE p.id IS NULL
        LIMIT 10
    ''')
    print('Sample Mismatches (in Lines but not in DB):')
    for row in cur.fetchall():
        print(f'- {{row[0]}}')

conn.close()
"
"""
stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

client.close()
