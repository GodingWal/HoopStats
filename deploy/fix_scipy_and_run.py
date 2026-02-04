import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PIP = f"{MODEL_DIR}/venv/bin/pip"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

print(f"Connecting to {HOST}...")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
print("Connected!")

# Install scipy
print("\n[1/2] Installing scipy...")
stdin, stdout, stderr = client.exec_command(f"{VENV_PIP} install scipy", timeout=120)
print(stdout.read().decode().strip())
err = stderr.read().decode().strip()
if err:
    print("Errors:", err)

# Now run actuals in background
print("\n[2/2] Running actuals job...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/cron_jobs.py actuals > /tmp/actuals.log 2>&1 &
echo "Started actuals job (PID: $!)"
sleep 3
tail -30 /tmp/actuals.log 2>/dev/null
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

print("\nDone! Check /tmp/actuals.log on VPS for progress.")
client.close()
