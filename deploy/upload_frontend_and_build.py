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
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=120)

# 1. Upload the file
sftp = client.open_sftp()
local_path = r"c:\Users\Goding Wal\Desktop\Hoop-Stats\client\src\pages\backtest.tsx"
remote_path = "/var/www/hoopstats/client/src/pages/backtest.tsx"

print(f"Uploading {local_path} -> {remote_path}...")
sftp.put(local_path, remote_path)
sftp.close()

# 2. Run Build
print("Running build (this may take a minute)...")
commands = [
    "cd /var/www/hoopstats && npm run build",
    "pm2 restart all"
]

for cmd in commands:
    print(f"Executing: {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    
    # Wait for valid completion
    exit_status = stdout.channel.recv_exit_status()
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print(f"STDERR: {err}")
    
    if exit_status != 0:
        print(f"Command failed with status {exit_status}")
        break

client.close()
print("Frontend update complete.")
