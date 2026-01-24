
import paramiko
import sys
import os

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
    
    if exit_status != 0:
        print(f"Command failed: {err}")
        print(f"Output: {out}")
        return False
    else:
        print(f"Output: {out}")
        return True

def upload_file(client, local_path, remote_path):
    print(f"Uploading {local_path} to {remote_path}...")
    sftp = client.open_sftp()
    try:
        sftp.put(local_path, remote_path)
        print("Upload successful.")
    except Exception as e:
        print(f"Upload failed: {e}")
    finally:
        sftp.close()

def main():
    client = create_ssh_client()
    try:
        # 1. Upload new routes file
        upload_file(client, "server/routes.ts", f"{REMOTE_DIR}/server/routes.ts")
        
        # 2. Upload sample-players.json just in case (to src location)
        # Ensure server/data exists on remote
        run_command(client, f"mkdir -p {REMOTE_DIR}/server/data")
        upload_file(client, "server/data/sample-players.json", f"{REMOTE_DIR}/server/data/sample-players.json")

        # 3. Rebuild
        print("Rebuilding application on VPS...")
        if run_command(client, f"cd {REMOTE_DIR} && npm run build"):
            print("Build successful.")
            
            # 4. Restart App
            print("Restarting application...")
            run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats")
            
            # 5. Verify
            print("Verifying...")
            run_command(client, "timeout 5s curl -I http://localhost:5000")
            
        else:
            print("Build failed.")

    finally:
        client.close()

if __name__ == "__main__":
    main()
