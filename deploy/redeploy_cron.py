import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Pulling latest code (cron_jobs.py)...")
stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && git pull origin main", timeout=60)
print(stdout.read().decode().strip())

print("\nChecking backfill completion...")
stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && grep 'Backfill complete!' backfill.log")
complete = stdout.read().decode().strip()
print(complete)

if not complete:
    print("Not done. Checking tail:")
    stdin, stdout, stderr = client.exec_command(f"cd {MODEL_DIR} && tail -n 5 backfill.log")
    print(stdout.read().decode().strip())

client.close()
