
import paramiko
import sys
import socket

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
DOMAIN = "courtside-edge.com"

def check_dns():
    print(f"Checking DNS for {DOMAIN}...")
    try:
        ip = socket.gethostbyname(DOMAIN)
        print(f"Resolved {DOMAIN} to {ip}")
        if ip != HOST:
            print(f"WARNING: Domain resolves to {ip}, but VPS is {HOST}")
        else:
            print("DNS looks correct.")
    except Exception as e:
        print(f"DNS Resolution failed: {e}")

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
    else:
        print(f"Output:\n{out}")

def main():
    # 1. Check DNS locally first
    check_dns()
    
    print("-" * 20)
    
    # 2. Check Remote Status
    client = create_ssh_client()
    try:
        # print("Checking UFW Status:")
        # run_command(client, "ufw status verbose")
        
        # print("\nChecking Nginx Status:")
        # run_command(client, "systemctl status nginx --no-pager")
        
        # print("\nChecking Ports (Listening):")
        # run_command(client, "ss -tuln | grep -E ':(80|5000)'")
        
        print("\nChecking App Status:")
        run_command(client, "pm2 stop hoopstats")
        print("\nRunning App Manually (to catch error):")
        # Run with timeout or expect failure
        run_command(client, f"cd /var/www/hoopstats && timeout 10s node dist/index.cjs")
        
        print("\nRestoring App Status:")
        run_command(client, f"cd /var/www/hoopstats && pm2 start dist/index.cjs --name hoopstats")
        
        print("\nChecking Nginx Config Syntax:")
        run_command(client, "nginx -t")

        print("\nCurl Localhost:")
        run_command(client, "curl -I http://localhost:5000")
        run_command(client, "curl -I http://localhost")

    finally:
        client.close()

if __name__ == "__main__":
    main()
