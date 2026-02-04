import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
ROOT_DIR = "/var/www/hoopstats"
MODEL_DIR = f"{ROOT_DIR}/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

print(f"Connecting to {HOST}...")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
print("Connected!")

# Sync with GitHub
print("\n[1/2] Syncing with GitHub...")
stdin, stdout, stderr = client.exec_command(f"cd {ROOT_DIR} && git fetch --all && git reset --hard origin/main", timeout=60)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Run validation
print("\n[2/2] Running validation...")
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
