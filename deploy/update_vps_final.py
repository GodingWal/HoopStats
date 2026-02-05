import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, cmd):
    print(f"Running: {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    
    # Wait for completion
    exit_status = stdout.channel.recv_exit_status()
    
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out: print(out)
    if err: print(f"STDERR: {err}")
    
    if exit_status != 0:
        print(f"Command failed with status {exit_status}")
        # Don't exit, try to continue or let user know
    return exit_status

print(f"Connecting to {HOST}...")
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

cmds = [
    "cd /var/www/hoopstats && git pull",
    "cd /var/www/hoopstats && npm install",
    "cd /var/www/hoopstats && npm run build",
    "pm2 restart all"
]

for cmd in cmds:
    run_command(client, cmd)

client.close()
print("VPS Update Complete.")
