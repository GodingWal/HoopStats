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

print("Fetching PM2 logs...")
# Get last 100 lines of logs
cmd = "pm2 logs hoopstats --lines 100 --nostream"
stdin, stdout, stderr = client.exec_command(cmd)
print(stdout.read().decode().strip())
print(stderr.read().decode().strip())

client.close()
