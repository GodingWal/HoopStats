import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

# Python script to run on VPS
POPULATE_SCRIPT = '''
import os
import sys
import psycopg2
from datetime import datetime, timedelta

sys.path.insert(0, "/var/www/hoopstats/server/nba-prop-model")
from src.data.nba_api_client import NBADataClient

db_url = os.environ.get("DATABASE_URL")
if not db_url:
    print("No DATABASE_URL")
    sys.exit(1)

conn = psycopg2.connect(db_url)
cursor = conn.cursor()
nba_client = NBADataClient(request_delay=0.8)

STAT_TYPE_MAP = {
    "Points": "PTS",
    "Rebounds": "REB",
    "Assists": "AST",
    "3-PT Made": "FG3M",
    "3-Pointers Made": "FG3M",
    "Steals": "STL",
    "Blocks": "BLK",
    "Turnovers": "TOV",
    "Pts+Rebs": ["PTS", "REB"],
    "Pts+Asts": ["PTS", "AST"],
    "Rebs+Asts": ["REB", "AST"],
    "Pts+Rebs+Asts": ["PTS", "REB", "AST"],
    "Blks+Stls": ["BLK", "STL"],
}

target_date = "2026-02-01"
target_dt = datetime.strptime(target_date, "%Y-%m-%d")

# Determine season
if target_dt.month >= 10:
    season = f"{target_dt.year}-{str(target_dt.year + 1)[2:]}"
else:
    season = f"{target_dt.year - 1}-{str(target_dt.year)[2:]}"

# Get all lines needing actuals
cursor.execute("""
    SELECT id, player_name, stat_type, opening_line 
    FROM prizepicks_daily_lines 
    WHERE game_date = %s AND actual_value IS NULL
    AND stat_type IN ('Points', 'Rebounds', 'Assists', '3-PT Made', 'Steals', 'Blocks', 'Turnovers')
""", (target_date,))

lines = cursor.fetchall()
print(f"Found {len(lines)} lines needing actuals for {target_date}")

player_cache = {}
updated = 0

for line_id, player_name, stat_type, line in lines:
    try:
        cache_key = player_name.lower()
        if cache_key not in player_cache:
            player_id = nba_client.get_player_id(player_name)
            if player_id:
                game_log = nba_client.get_player_game_log(player_id, season=season)
                player_cache[cache_key] = game_log
            else:
                player_cache[cache_key] = None
                continue
        
        game_log = player_cache[cache_key]
        if game_log is None or game_log.empty:
            continue
            
        # Find game on target date
        target_dt_only = datetime.strptime(target_date, "%Y-%m-%d").date()
        game_row = game_log[game_log["GAME_DATE"].dt.date == target_dt_only]
        
        if game_row.empty:
            continue
            
        # Get stat value
        nba_col = STAT_TYPE_MAP.get(stat_type)
        if nba_col is None:
            continue
            
        if isinstance(nba_col, list):
            actual_value = sum(float(game_row.iloc[0][col]) for col in nba_col)
        else:
            if nba_col not in game_row.columns:
                continue
            actual_value = float(game_row.iloc[0][nba_col])
        
        hit_over = actual_value > line if line else None
        
        cursor.execute("""
            UPDATE prizepicks_daily_lines 
            SET actual_value = %s, hit_over = %s 
            WHERE id = %s
        """, (actual_value, hit_over, line_id))
        
        updated += 1
        if updated % 20 == 0:
            print(f"Updated {updated} records...")
            
    except Exception as e:
        print(f"Error {player_name}: {e}")
        continue

conn.commit()
cursor.close()
conn.close()
print(f"Total updated: {updated}")
'''

print(f"Connecting to {HOST}...")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
print("Connected!")

# Write and run the script
print("\nRunning direct actuals population...")
import base64
encoded = base64.b64encode(POPULATE_SCRIPT.encode()).decode()
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
echo '{encoded}' | base64 -d > /tmp/populate_direct.py &&
{VENV_PYTHON} /tmp/populate_direct.py 2>&1
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=300)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Check results
print("\nChecking results...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "
SELECT stat_type, COUNT(*) as total, COUNT(actual_value) as with_actuals 
FROM prizepicks_daily_lines 
WHERE game_date = '2026-02-01'
GROUP BY stat_type 
ORDER BY with_actuals DESC;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())

client.close()
print("\nDone!")
