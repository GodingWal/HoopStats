
import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USERNAME, password=PASSWORD)
        return client
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

def run_command(client, command):
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    # Print output regardless of success
    if out:
        print(f"STDOUT:\n{out}")
    if err:
        print(f"STDERR:\n{err}")

def main():
    client = create_ssh_client()
    try:
        # run_command(client, "pm2 stop hoopstats")
        print("-" * 20)
        run_command(client, f"ls -la {REMOTE_DIR}/dist/data")
        print("-" * 20)
        run_command(client, f"cd {REMOTE_DIR} && timeout 10s node dist/index.cjs")
        print("-" * 20)
        run_command(client, f"cd {REMOTE_DIR} && pm2 start dist/index.cjs --name hoopstats")
    finally:
        client.close()

if __name__ == "__main__":
    main()
