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

# Run actuals for Feb 2
print("\n[1/3] Running actuals for 2026-02-02...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} scripts/cron_jobs.py actuals --date 2026-02-02 2>&1 | tail -30
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Run validation
print("\n[2/3] Running validation...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} scripts/cron_jobs.py validate 2>&1 | tail -60
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Final check
print("\n[3/3] Final status check...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "SELECT game_date, COUNT(*) as total, COUNT(actual_value) as with_actuals FROM prizepicks_daily_lines GROUP BY game_date ORDER BY game_date;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())

client.close()
print("\nDone!")
