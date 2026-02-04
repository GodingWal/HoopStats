import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Killing old processes...")
# Kill python processes running backfill_players.py
cmd = "pkill -f backfill_players.py"
stdin, stdout, stderr = client.exec_command(cmd)
print(f"Kill output: {stdout.read().decode().strip()} {stderr.read().decode().strip()}")

time.sleep(2)

# Restart
print("Restarting...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/backfill_players.py > backfill.log 2>&1 &
echo $!
"""
stdin, stdout, stderr = client.exec_command(cmd)
pid = stdout.read().decode().strip()
print(f"Started CLEAN backfill process ID: {pid}")

client.close()
