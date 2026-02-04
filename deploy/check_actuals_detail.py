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

# Check what stat types have actuals
print("\n[1/2] Checking actuals by stat type...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "
SELECT stat_type, game_date, COUNT(*) as total, COUNT(actual_value) as with_actuals 
FROM prizepicks_daily_lines 
WHERE game_date = '2026-02-01'
GROUP BY stat_type, game_date 
ORDER BY with_actuals DESC;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())

# Check some sample records with actuals
print("\n[2/2] Sample records with actuals...")
stdin, stdout, stderr = client.exec_command("""
export $(cat /var/www/hoopstats/.env | xargs 2>/dev/null)
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p') psql -h $(echo $DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p') -U $(echo $DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p') -d $(echo $DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p') -c "
SELECT player_name, stat_type, opening_line, actual_value, hit_over 
FROM prizepicks_daily_lines 
WHERE actual_value IS NOT NULL 
ORDER BY game_date DESC 
LIMIT 15;" 2>&1
""", timeout=30)
print(stdout.read().decode().strip())

client.close()
print("\nDone!")
