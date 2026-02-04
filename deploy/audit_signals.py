import paramiko
import sys
import json

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

# Use database URL or -h localhost to force TCP/IP (md5) if peer fails
# Assuming password for postgres user is 'postgres' or similar, OR using the app user.
# The app uses DATABASE_URL=postgres://neondb_owner:npg_6C...
# I'll source .env to get the real connection string.

cmd_env = "cat /var/www/hoopstats/server/nba-prop-model/.env"
stdin, stdout, stderr = client.exec_command(cmd_env)
env_content = stdout.read().decode()

db_url = ""
for line in env_content.split('\n'):
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"')
        break

if not db_url:
    print("Could not find DATABASE_URL in .env")
    # Fallback to local socket if configured
    db_url = "postgresql://postgres:postgres@localhost:5432/nba_props" 

print(f"Using DB: {db_url[:20]}...")

# PSQL command using the URL
psql_cmd = f"""psql "{db_url}" """

print("\n--- Signal Performance Table ---")
# Use list format? No, keeping table is readable.
full_cmd = f"""{psql_cmd} -c "SELECT signal_name, stat_type, sum(predictions_made) as count, round(avg(accuracy), 3) as avg_acc FROM signal_performance GROUP BY signal_name, stat_type ORDER BY count DESC;" """
stdin, stdout, stderr = client.exec_command(full_cmd)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

print("\n--- Projection Logs (Sample Keys) ---")
full_cmd_logs = f"""{psql_cmd} -t -c "SELECT signals FROM projection_logs WHERE created_at > NOW() - INTERVAL '48 hours' ORDER BY created_at DESC LIMIT 50;" """
stdin, stdout, stderr = client.exec_command(full_cmd_logs)
raw_logs = stdout.read().decode().strip()

signal_counts = {}
valid_rows = 0

if raw_logs:
    rows = raw_logs.split('\n')
    for row in rows:
        row = row.strip()
        if not row: continue
        try:
            valid_rows += 1
            signals = json.loads(row)
            for k in signals.keys():
                signal_counts[k] = signal_counts.get(k, 0) + 1
        except Exception as e:
            pass

print(f"\nScanned {valid_rows} recent projections.")
print("Signal frequencies:")
for k, v in sorted(signal_counts.items(), key=lambda x: x[1], reverse=True):
    print(f"  {k}: {v} ({v/valid_rows*100:.1f}%)")

client.close()
