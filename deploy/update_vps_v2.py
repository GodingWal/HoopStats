import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def run_command(client, command, timeout=300):
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print('='*60)
    
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    
    # Read output
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    exit_code = stdout.channel.recv_exit_status()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    print(f"Exit code: {exit_code}")
    
    return exit_code == 0

def main():
    print(f"Connecting to {HOST}...")
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected successfully!")
        
        # Step 1: Git sync
        print("\n[1/4] Syncing with GitHub...")
        run_command(client, f"cd {REMOTE_DIR} && git fetch --all && git reset --hard origin/main")
        
        # Step 2: Install dependencies
        print("\n[2/4] Installing dependencies...")
        run_command(client, f"cd {REMOTE_DIR} && npm install", timeout=180)
        
        # Step 3: Run db:push
        print("\n[3/4] Running database migrations...")
        run_command(client, f"cd {REMOTE_DIR} && npm run db:push", timeout=1200)
        
        # Step 4: Build
        print("\n[4/4] Building application...")
        run_command(client, f"cd {REMOTE_DIR} && npm run build", timeout=300)
        
        # Step 5: Restart PM2
        print("\n[5/5] Restarting PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats")
        
        # Check status
        print("\n[VERIFICATION] Checking PM2 status...")
        run_command(client, "pm2 status")
        
        print("\n" + "="*60)
        print("UPDATE COMPLETE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
