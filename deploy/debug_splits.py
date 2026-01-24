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

def run_command(client, command, timeout=120):
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
        print("1. Checking recent PM2 error logs...")
        run_command(client, "pm2 logs hoopstats --err --lines 50 --nostream")
        
        print("\n" + "=" * 50)
        print("2. Testing Python script directly with Neemias Queta (4397424)...")
        # The user is looking at Neemias Queta - let's find his player ID
        test_cmd = f"cd {REMOTE_DIR} && .venv/bin/python server/nba-prop-model/src/data/on_off_calculator.py --player-id 4397424 --team BOS --seasons 2024-25"
        run_command(client, test_cmd, timeout=180)
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
