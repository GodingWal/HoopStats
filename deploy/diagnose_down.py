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
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!\n")
    
    print("="*60)
    print("DIAGNOSING WEBSITE STATUS")
    print("="*60)
    
    # Check PM2 status
    print("\n[1] PM2 Status:")
    run_command(client, "pm2 status")
    
    # Check PM2 logs
    print("\n[2] PM2 Logs (last 30 lines):")
    run_command(client, "pm2 logs hoopstats --lines 30 --nostream")
    
    # Check nginx status
    print("\n[3] Nginx Status:")
    run_command(client, "systemctl status nginx --no-pager")
    
    # Check if port 5000 is listening
    print("\n[4] Port 5000 listening:")
    run_command(client, "ss -tlnp | grep 5000")
    
    # Test localhost
    print("\n[5] Test localhost:5000:")
    run_command(client, "curl -s http://localhost:5000/api/health || echo 'FAILED'")
    
    # Restart PM2 if needed
    print("\n[6] Restarting PM2 process...")
    run_command(client, "cd /var/www/hoopstats && pm2 restart hoopstats")
    
    import time
    time.sleep(3)
    
    # Final test
    print("\n[7] Final test after restart:")
    run_command(client, "curl -s http://localhost:5000/api/health || echo 'FAILED'")
    
    client.close()

if __name__ == "__main__":
    main()
