import paramiko
import sys

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Check git status and recent commits
        print("\n=== Checking git status ===")
        stdin, stdout, stderr = client.exec_command(f"cd {REMOTE_DIR} && git log --oneline -3")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        # Check if RefFoulSignal.tsx has games-today
        print("\n=== Checking frontend component ===")
        stdin, stdout, stderr = client.exec_command(f"grep -c 'games-today' {REMOTE_DIR}/client/src/components/RefFoulSignal.tsx || echo 'NOT FOUND'")
        print(f"games-today occurrences: {stdout.read().decode().strip()}")
        
        # Check PM2 status
        print("\n=== PM2 Status ===")
        stdin, stdout, stderr = client.exec_command("pm2 status")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        # Check if built files exist
        print("\n=== Checking dist files ===")
        stdin, stdout, stderr = client.exec_command(f"ls -la {REMOTE_DIR}/dist/public/assets/ | head -5")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
