import paramiko
import time
import sys

if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Fix PM2 Process ===")
        
        # Delete existing
        print("Deleting hoopstats...")
        client.exec_command("pm2 delete hoopstats")
        time.sleep(2)
        
        # Kill manual run if any
        print("Killing any manual node processes...")
        client.exec_command("pkill -f 'node dist/index.cjs'")
        time.sleep(2)
        
        # Start fresh
        print("Starting hoopstats...")
        # Ensure we are in the right directory
        cmd = "cd /var/www/hoopstats && pm2 start dist/index.cjs --name hoopstats"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        print(stderr.read().decode())
        
        print("Saving PM2 list...")
        client.exec_command("pm2 save")
        
        print("Waiting for startup (5s)...")
        time.sleep(5)
        
        print("=== Checking Logs Head ===")
        cmd = "head -n 20 /root/.pm2/logs/hoopstats-out-0.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
