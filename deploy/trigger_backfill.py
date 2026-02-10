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
        
        print("=== Pulling latest code ===")
        stdin, stdout, stderr = client.exec_command("cd /var/www/hoopstats && git pull")
        print(stdout.read().decode())
        print(stderr.read().decode())

        # Check if python dependencies are installed (like pandas, psycopg2)
        # Assuming they are from previous steps.

        print("=== Running Backfill (Limit 50 first to test) ===")
        # Run with limit first to verify it works without crashing
        cmd = "cd /var/www/hoopstats && /usr/bin/python3 server/nba-prop-model/scripts/backfill_players.py --season 2025-26"
        
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # Read output in real-time or wait?
        # Standard synchronous read
        out = stdout.read().decode('utf-8', errors='replace')
        err = stderr.read().decode('utf-8', errors='replace')
        print(out)
        if err:
            print(f"STDERR: {err}")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
