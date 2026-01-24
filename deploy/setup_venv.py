import paramiko
import sys

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

def run_command(client, command, timeout=180):
    print(f"\n>>> {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    print(f"Exit code: {exit_status}")
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("=" * 50)
        print("1. Creating Python virtual environment...")
        run_command(client, f"cd {REMOTE_DIR} && python3 -m venv .venv")
        
        print("\n" + "=" * 50)
        print("2. Installing dependencies in venv...")
        run_command(client, f"cd {REMOTE_DIR} && .venv/bin/pip install --upgrade pip")
        run_command(client, f"cd {REMOTE_DIR} && .venv/bin/pip install nba_api pandas numpy requests")
        
        print("\n" + "=" * 50)
        print("3. Creating python3 symlink to venv...")
        # Create a wrapper script that uses the venv python
        wrapper_script = """#!/bin/bash
source /var/www/hoopstats/.venv/bin/activate
python3 "$@"
"""
        # Write wrapper via ssh
        run_command(client, f'echo \'{wrapper_script}\' > /usr/local/bin/hoopstats-python')
        run_command(client, "chmod +x /usr/local/bin/hoopstats-python")
        
        print("\n" + "=" * 50)
        print("4. Testing venv python...")
        run_command(client, f"cd {REMOTE_DIR} && .venv/bin/python -c 'import nba_api; print(\"nba_api installed successfully\")'")
        
        print("\n" + "=" * 50)
        print("5. Restarting PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats")
        
        print("\n" + "=" * 50)
        print("Setup Complete!")
        print("\nNote: The on-off-service.ts needs to be updated to use .venv/bin/python instead of 'python'")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
