import paramiko
import time

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Forcing Update (Hard Reset) ===")
        # Fetch and Reset
        cmd = "cd /var/www/hoopstats && git fetch origin && git reset --hard origin/main"
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        print(stderr.read().decode())

        print("=== Running Full Backfill ===")
        cmd = "cd /var/www/hoopstats && /usr/bin/python3 server/nba-prop-model/scripts/backfill_players.py --season 2025-26"
        print(f"Executing: {cmd}")
        # Run properly
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # Stream output? NO, just wait or check status.
        # But this script is synchronous on my end?
        # If I want to see output I should read.
        # But backfill takes 5 mins.
        # I'll let it run and this script will finish when done.
        
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line.strip())
            
        err = stderr.read().decode()
        if err:
            print(f"STDERR: {err}")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
