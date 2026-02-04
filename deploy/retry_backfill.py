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

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Connected!")

# 1. Install deps
print("\n[1/3] Installing python-dotenv...")
stdin, stdout, stderr = client.exec_command(f"{VENV_PIP} install python-dotenv pandas nba_api unidecode", timeout=120)
print(stdout.read().decode().strip())
err = stderr.read().decode().strip()
if err: print(f"Stderr: {err}")

# 2. Sync Code (Backtest Engine)
print("\n[2/3] Syncing code...")
stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && git pull origin main", timeout=60)
print(stdout.read().decode().strip())

# 3. Restart Backfill
print("\n[3/3] Restarting backfill...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
nohup {VENV_PYTHON} scripts/backfill_players.py > backfill.log 2>&1 &
echo $!
"""
stdin, stdout, stderr = client.exec_command(cmd)
pid = stdout.read().decode().strip()
print(f"Started backfill process ID: {pid}")

client.close()
