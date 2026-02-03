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
    print("CHECKING NGINX AND DNS")
    print("="*60)
    
    # Check current nginx config
    print("\n[1] Nginx configuration:")
    run_command(client, "cat /etc/nginx/sites-available/hoopstats")
    
    # Check nginx access log for requests
    print("\n[2] Recent nginx access logs:")
    run_command(client, "tail -20 /var/log/nginx/access.log")
    
    # Check nginx error log
    print("\n[3] Recent nginx error logs:")
    run_command(client, "tail -10 /var/log/nginx/error.log")
    
    # Check if server can reach the domain
    print("\n[4] Testing curl to domain from server:")
    run_command(client, "curl -s -o /dev/null -w '%{http_code}' -H 'Host: courtside-edge.com' http://127.0.0.1/api/health")
    
    # Check if curl to external IP works
    print("\n[5] Testing curl to IP from server:")
    run_command(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/health")
    
    # DNS resolution from server
    print("\n[6] DNS resolution from server:")
    run_command(client, "host courtside-edge.com")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
