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

cmd_env = "cat /var/www/hoopstats/.env"
stdin, stdout, stderr = client.exec_command(cmd_env)
env_content = stdout.read().decode()

db_url = ""
for line in env_content.split('\n'):
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break

if not db_url:
    print("Could not find DATABASE_URL in .env")
    sys.exit(1)

psql_cmd = f"""psql "{db_url}" """

print("\n--- Signal Performance Table (Active Signals) ---")
# Added ::numeric cast for ROUND
full_cmd = f"""{psql_cmd} -c "SELECT signal_name, stat_type, sum(predictions_made) as count, round(avg(accuracy)::numeric, 3) as avg_acc FROM signal_performance GROUP BY signal_name, stat_type ORDER BY count DESC;" """
stdin, stdout, stderr = client.exec_command(full_cmd)
output = stdout.read().decode().strip()
if output:
    print(output)
else:
    print("No signals found in performance table.")
err = stderr.read().decode().strip()
if err: print(f"Error: {err}")

print("\n--- Projection Logs (Total Signals Generated) ---")
# Removed time filter to just get LAST 100 rows regardless of time
full_cmd_logs = f"""{psql_cmd} -t -c "SELECT signals FROM projection_logs ORDER BY id DESC LIMIT 100;" """
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
            signals = json.loads(row)
            valid_rows += 1
            for k in signals.keys():
                signal_counts[k] = signal_counts.get(k, 0) + 1
        except Exception as e:
            pass

print(f"\nScanned {valid_rows} recent projections.")
print("Signal Presence Frequency:")
sorted_signals = sorted(signal_counts.items(), key=lambda x: x[1], reverse=True)
for k, v in sorted_signals:
    print(f"  {k}: {v} ({v/valid_rows*100:.1f}%)")

client.close()
