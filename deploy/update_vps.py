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
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Error:\n{err}")
        
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("Starting VPS Update...")
        
        # 1. Pull latest changes
        # We try git pull first. If local changes exist on VPS, we might need stash or reset.
        # We'll try reset hard to be sure we match main.
        print("Syncing with git origin/main...")
        success = run_command(client, f"cd {REMOTE_DIR} && git fetch --all && git reset --hard origin/main")
        
        if not success:
            print("Git reset failed. Attempting simple pull...")
            run_command(client, f"cd {REMOTE_DIR} && git pull origin main")

        # 2. Install dependencies (backend & frontend) in case package.json changed
        print("Installing dependencies...")
        run_command(client, f"cd {REMOTE_DIR} && npm install")

        # 2a. Run Database Options
        print("Running database migrations...")
        run_command(client, f"cd {REMOTE_DIR} && npm run db:push")

        # 3. Build the application
        print("Building application...")
        run_command(client, f"cd {REMOTE_DIR} && npm run build")

        # 4. Restart PM2
        print("Restarting application via PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats")
        
        print("Update Complete.")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
