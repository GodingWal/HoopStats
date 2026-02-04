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

print("Waiting for backfill completion...")

for i in range(10): # 10 * 30s = 5 mins max
    stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && grep 'Backfill complete!' backfill.log")
    complete = stdout.read().decode().strip()
    
    if complete:
        print("Backfill complete!")
        print(complete)
        break
    
    print(f"Not done yet. Waiting 30s... (Attempt {i+1}/10)")
    # Show progress
    stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && tail -n 1 backfill.log")
    print(stdout.read().decode().strip())
    
    time.sleep(30)

print("\nRunning validation...")
cmd = f"""
cd {MODEL_DIR} && 
export $(cat ../../.env | xargs 2>/dev/null) &&
{VENV_PYTHON} scripts/cron_jobs.py validate
"""
stdin, stdout, stderr = client.exec_command(cmd)
print("Validation output:")
# Read streaming output if possible? 
# Validation logs to stdout if configured, but cron_jobs.py logs to file /tmp/hoopstats_cron.log?
# My cron_jobs.py setup:
# handlers=[logging.StreamHandler(), logging.FileHandler('/tmp/hoopstats_cron.log')]
# So it prints to stdout too.
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

client.close()
