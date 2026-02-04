import paramiko
import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

local_path = r"c:\Users\Goding Wal\Desktop\Hoop-Stats\server\nba-prop-model\src\evaluation\backtest_engine.py"
remote_path = "/var/www/hoopstats/server/nba-prop-model/src/evaluation/backtest_engine.py"

print(f"Uploading {local_path} -> {remote_path}...")
sftp = client.open_sftp()
sftp.put(local_path, remote_path)
sftp.close()

print("Restarting PM2...")
cmd_restart = "pm2 restart hoopstats"
stdin, stdout, stderr = client.exec_command(cmd_restart)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
