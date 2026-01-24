import paramiko
import sys

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

def run_command(client, command, timeout=120):
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
        print("1. Installing nba_api package...")
        run_command(client, "pip3 install nba_api pandas numpy")
        
        print("\n" + "=" * 50)
        print("2. Creating python symlink (if needed)...")
        run_command(client, "which python3")
        run_command(client, "ln -sf /usr/bin/python3 /usr/bin/python || true")
        
        print("\n" + "=" * 50)
        print("3. Verifying installation...")
        run_command(client, "python3 -c 'import nba_api; print(\"nba_api installed successfully\")'")
        
        print("\n" + "=" * 50)
        print("4. Restarting PM2...")
        run_command(client, "cd /var/www/hoopstats && pm2 restart hoopstats")
        
        print("\n" + "=" * 50)
        print("Setup Complete!")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
