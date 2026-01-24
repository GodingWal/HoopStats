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

def run_command(client, command, timeout=60):
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
        print("1. Checking Python version...")
        run_command(client, "python3 --version")
        run_command(client, "python --version")
        
        print("\n" + "=" * 50)
        print("2. Checking if nba_api is installed...")
        run_command(client, "python3 -c 'import nba_api; print(nba_api.__version__)'")
        
        print("\n" + "=" * 50)
        print("3. Checking if on_off_calculator.py exists...")
        run_command(client, f"ls -la {REMOTE_DIR}/server/nba-prop-model/src/data/on_off_calculator.py")
        
        print("\n" + "=" * 50)
        print("4. Checking PM2 logs for errors...")
        run_command(client, "pm2 logs hoopstats --lines 30 --nostream")
        
        print("\n" + "=" * 50)
        print("5. Testing Python script directly (may take a while)...")
        # Use a real player ID for testing - Onyeka Okongwu (1630168)
        test_cmd = f"cd {REMOTE_DIR} && python3 server/nba-prop-model/src/data/on_off_calculator.py --player-id 1630168 --team ATL --seasons 2024-25"
        run_command(client, test_cmd, timeout=120)
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
