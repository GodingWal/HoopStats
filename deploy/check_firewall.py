import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=60):
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print('='*60)
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
    print("CHECKING FIREWALL AND PORTS")
    print("="*60)
    
    # Check UFW status
    print("\n[1] UFW Firewall Status:")
    run_command(client, "ufw status verbose")
    
    # Check iptables
    print("\n[2] IPTables Rules:")
    run_command(client, "iptables -L -n --line-numbers | head -50")
    
    # Check what's listening on all ports
    print("\n[3] All Listening Ports:")
    run_command(client, "ss -tlnp")
    
    # Check nginx is listening on 80
    print("\n[4] Port 80 specifically:")
    run_command(client, "ss -tlnp | grep ':80'")
    
    # Check nginx config
    print("\n[5] Nginx configuration test:")
    run_command(client, "nginx -t")
    
    # Check nginx status
    print("\n[6] Nginx service status:")
    run_command(client, "systemctl status nginx --no-pager")
    
    # Check if we can curl from localhost
    print("\n[7] Test localhost on various ports:")
    run_command(client, "curl -s -o /dev/null -w '%{http_code}' http://localhost:80 || echo 'FAILED'")
    run_command(client, "curl -s -o /dev/null -w '%{http_code}' http://localhost:5000 || echo 'FAILED'")
    
    # Check PM2 status
    print("\n[8] PM2 Status:")
    run_command(client, "pm2 status")
    
    # Allow port 80 in UFW if needed
    print("\n[9] Ensuring port 80 is allowed in UFW:")
    run_command(client, "ufw allow 80/tcp")
    run_command(client, "ufw allow 443/tcp")
    run_command(client, "ufw allow 'Nginx Full'")
    
    # Check UFW status again
    print("\n[10] UFW Status after updates:")
    run_command(client, "ufw status")
    
    # Reload nginx
    print("\n[11] Reloading nginx:")
    run_command(client, "systemctl reload nginx")
    
    client.close()
    print("\n" + "="*60)
    print("DIAGNOSTIC COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
