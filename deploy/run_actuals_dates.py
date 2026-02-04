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

# Run actuals for Feb 1 and Feb 2
for date in ['2026-02-01', '2026-02-02']:
    print(f"\nRunning actuals for {date}...")
    cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} scripts/cron_jobs.py actuals --date {date} 2>&1 | head -30
"""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    print(stdout.read().decode().strip())
    print(stderr.read().decode().strip())

# Check if any actuals were populated
print("\nChecking actuals status...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "SELECT game_date, COUNT(*) as total, COUNT(actual_value) as with_actuals FROM prizepicks_daily_lines GROUP BY game_date ORDER BY game_date;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())

client.close()
print("\nDone!")
