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

# Check date range of data
print("\n[1/3] Checking date range of captured data...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "SELECT game_date, COUNT(*) as cnt, COUNT(actual_value) as with_actuals FROM prizepicks_daily_lines GROUP BY game_date ORDER BY game_date DESC LIMIT 15;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Run validate for backtest results
print("\n[2/3] Running validate job...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/cron_jobs.py validate > /tmp/validate.log 2>&1 &
echo "Started validate job"
sleep 5
tail -50 /tmp/validate.log 2>/dev/null
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Check backtest_runs table
print("\n[3/3] Checking backtest results...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "SELECT stat_type, days_evaluated, total_predictions, overall_accuracy FROM backtest_runs ORDER BY run_completed_at DESC LIMIT 10;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

print("\nDone!")
client.close()
