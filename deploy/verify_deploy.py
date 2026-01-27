
import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

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
    
    print(f"Output:\n{out}")
    if err:
        print(f"Error:\n{err}")

def main():
    client = create_ssh_client()
    try:
        print("--- VERIFICATION START ---")
        
        # Check backend code
        print("Checking backend code:")
        run_command(client, "grep -c 'upload-screenshot' /var/www/hoopstats/server/routes/bets-routes.ts || echo 'NOT FOUND'")
        
        # Check frontend build assets (grep for string in built JS files)
        print("Checking frontend assets for ImportBetsDialog:")
        run_command(client, "grep -r 'Screenshot' /var/www/hoopstats/dist/public/assets/ || echo 'NOT FOUND'")

        # Check build time
        print("Checking build timestamp:")
        run_command(client, "stat -c '%y' /var/www/hoopstats/dist/index.cjs")
        
        print("--- VERIFICATION END ---")
    finally:
        client.close()

if __name__ == "__main__":
    main()
