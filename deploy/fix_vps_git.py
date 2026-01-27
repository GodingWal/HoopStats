import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REPO_URL = "https://github.com/GodingWal/HoopStats.git"
APP_DIR = "/var/www/hoopstats"
NEW_DIR = "/var/www/hoopstats_new"
BACKUP_DIR = "/var/www/hoopstats_backup"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USERNAME, password=PASSWORD)
        return client
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

def run_command(client, command, ignore_error=False):
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"Output:\n{out}")
    if err and not ignore_error:
        print(f"Error:\n{err}")
        
    if exit_status != 0 and not ignore_error:
        raise Exception(f"Command failed: {command}")
    
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("Starting VPS Repair...")

        # 1. Prepare new directory
        print("\n1. Cloning fresh repository...")
        run_command(client, f"rm -rf {NEW_DIR}", ignore_error=True)
        run_command(client, f"git clone {REPO_URL} {NEW_DIR}")

        # 2. Preserve configuration
        print("\n2. Preserving .env file...")
        # Check if .env exists
        stdin, stdout, stderr = client.exec_command(f"[ -f {APP_DIR}/.env ] && echo 'exists'")
        if stdout.read().decode().strip() == 'exists':
            run_command(client, f"cp {APP_DIR}/.env {NEW_DIR}/.env")
            print("   .env copied successfully.")
        else:
            print("   WARNING: No .env found in current app directory.")

        # 3. Install dependencies in new dir
        print("\n3. Installing dependencies...")
        run_command(client, f"cd {NEW_DIR} && npm install")

        # 4. Stop current app
        print("\n4. Stopping application...")
        run_command(client, "pm2 stop hoopstats", ignore_error=True)

        # 5. Swap directories
        print("\n5. Swapping directories...")
        run_command(client, f"rm -rf {BACKUP_DIR}", ignore_error=True)
        # Verify app dir exists before moving
        stdin, stdout, stderr = client.exec_command(f"[ -d {APP_DIR} ] && echo 'exists'")
        if stdout.read().decode().strip() == 'exists':
             run_command(client, f"mv {APP_DIR} {BACKUP_DIR}")
        
        run_command(client, f"mv {NEW_DIR} {APP_DIR}")

        # 6. Database Migration (Important!)
        print("\n6. Running database migrations...")
        run_command(client, f"cd {APP_DIR} && npm run db:push")

        # 7. Build
        print("\n7. Building application...")
        run_command(client, f"cd {APP_DIR} && npm run build")

        # 8. Start app
        print("\n8. Restarting application...")
        run_command(client, f"cd {APP_DIR} && pm2 restart hoopstats")
        
        print("\nREPAIR COMPLETE successfully.")
        
    except Exception as e:
        print(f"\nFATAL ERROR: {e}")
        sys.exit(1)
    finally:
        client.close()

if __name__ == "__main__":
    main()
