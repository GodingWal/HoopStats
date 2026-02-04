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

# Run nohup to run in background so it doesn't hang
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/cron_jobs.py actuals > /tmp/actuals.log 2>&1 &
echo "Started actuals job in background"
sleep 2
tail -20 /tmp/actuals.log 2>/dev/null || echo "Log not ready yet"
"""

print("Running actuals job in background...")
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

# Also start validate in background
cmd2 = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/cron_jobs.py validate > /tmp/validate.log 2>&1 &
echo "Started validate job in background"
"""

print("\nStarting validate job in background...")
stdin, stdout, stderr = client.exec_command(cmd2, timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

print("\nJobs started! Check /tmp/actuals.log and /tmp/validate.log on VPS for progress.")
client.close()
