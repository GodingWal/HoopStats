import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=60):
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    return exit_status == 0, out

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    
    print("Debugging nginx configuration...")
    
    # Check what's in sites-enabled
    run_command(client, "ls -la /etc/nginx/sites-enabled/")
    
    # Check the config content
    run_command(client, "cat /etc/nginx/sites-available/hoopstats")
    
    # Reload nginx
    run_command(client, "systemctl reload nginx")
    
    # Test again
    print("\nTesting localhost:5000 directly...")
    run_command(client, "curl -s http://localhost:5000/api/health")
    
    print("\nTesting via nginx on port 80...")
    run_command(client, "curl -s http://localhost/api/health")
    
    # Check nginx error log
    print("\nNginx error log (last 10 lines)...")
    run_command(client, "tail -10 /var/log/nginx/error.log")
    
    client.close()

if __name__ == "__main__":
    main()
