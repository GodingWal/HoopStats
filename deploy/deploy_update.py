import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
PROJECT_DIR = "/var/www/hoopstats"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Deploying update...")
cmd = f"""
cd {PROJECT_DIR} &&
git pull origin main &&
echo "Rebuilding frontend..." &&
npm run build &&
pm2 restart hoopstats
"""

stdin, stdout, stderr = client.exec_command(cmd)
while True:
    line = stdout.readline()
    if not line:
        break
    print(line.strip())

print(stderr.read().decode().strip())
client.close()
