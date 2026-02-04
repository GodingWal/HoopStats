import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

print(f"Connecting to {HOST}...")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
print("Connected!")

# Quick check - just run ls
stdin, stdout, stderr = client.exec_command("ls /var/www/hoopstats/server/nba-prop-model/scripts/", timeout=10)
print("Scripts:", stdout.read().decode().strip())

# Check if venv exists
stdin, stdout, stderr = client.exec_command("ls /var/www/hoopstats/server/nba-prop-model/venv/bin/python", timeout=10)
print("Python:", stdout.read().decode().strip() or stderr.read().decode().strip())

# Check backtest data in DB
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "SELECT COUNT(*) as total_lines, COUNT(actual_value) as with_actuals FROM prizepicks_daily_lines;" 2>&1 | head -10
""", timeout=15)
out = stdout.read().decode().strip()
err = stderr.read().decode().strip()
print("DB Query:", out or err)

client.close()
print("Done!")
