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

# Run validation with shorter date range (only 5 days since we only have data from Feb 1)
print("\nRunning validation (5 days)...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} scripts/cron_jobs.py validate --days 5 2>&1
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

client.close()
print("\nDone!")
