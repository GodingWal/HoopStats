import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=60):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("NETWORK LEVEL DIAGNOSTICS")
    print("="*60)
    
    # Check if we're behind NAT or have public IP
    print("\n[1] Checking network interfaces and public IP:")
    run_command(client, "ip addr show | grep 'inet '")
    run_command(client, "curl -s ifconfig.me || curl -s ipinfo.io/ip")
    
    # Check if there are any iptables rules blocking
    print("\n[2] Current iptables (full):")
    run_command(client, "iptables -L -v -n")
    
    # Check if UFW is blocking (even when inactive, sometimes rules persist)
    print("\n[3] UFW app list and status:")
    run_command(client, "ufw app list")
    run_command(client, "ufw status numbered")
    
    # Enable UFW with proper rules
    print("\n[4] Enabling UFW with proper rules:")
    run_command(client, "ufw default deny incoming")
    run_command(client, "ufw default allow outgoing")
    run_command(client, "ufw allow ssh")
    run_command(client, "ufw allow 22/tcp")
    run_command(client, "ufw allow 80/tcp")
    run_command(client, "ufw allow 443/tcp")
    run_command(client, "ufw allow 'Nginx Full'")
    
    print("\n[5] Enabling UFW (non-interactive):")
    run_command(client, "echo 'y' | ufw enable")
    
    print("\n[6] UFW status after enabling:")
    run_command(client, "ufw status verbose")
    
    # Test if port 80 is reachable from localhost
    print("\n[7] Testing ports locally:")
    run_command(client, "nc -zv 127.0.0.1 80")
    run_command(client, "nc -zv 127.0.0.1 5000")
    
    # Test from the server's own external IP
    print("\n[8] Testing external connectivity:")
    run_command(client, f"curl -s --connect-timeout 5 http://76.13.100.125/api/health || echo 'TIMEOUT'")
    
    client.close()
    print("\n" + "="*60)
    print("DIAGNOSTICS COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
