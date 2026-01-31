import paramiko
import sys

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
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
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
        print(f"Output:\n{out[:2000]}")
    if err:
        print(f"Stderr:\n{err[:500]}")
    print(f"Exit code: {exit_status}")
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("=" * 50)
        print("1. Creating start.sh script...")
        
        # Create start.sh using heredoc
        create_script_cmd = """cat > /var/www/hoopstats/start.sh << 'EOF'
#!/bin/bash
cd /var/www/hoopstats
export NODE_ENV=production
node dist/index.cjs
EOF"""
        run_command(client, create_script_cmd)
        run_command(client, "chmod +x /var/www/hoopstats/start.sh")
        run_command(client, "cat /var/www/hoopstats/start.sh")
        
        print("\n" + "=" * 50)
        print("2. Reconfiguring PM2...")
        run_command(client, "pm2 delete hoopstats", timeout=30)
        run_command(client, f"cd {REMOTE_DIR} && pm2 start start.sh --name hoopstats")
        run_command(client, "pm2 save")
        
        print("\n" + "=" * 50)
        print("3. Checking status...")
        run_command(client, "pm2 status")
        
        print("\n" + "=" * 50)
        print("Done!")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
