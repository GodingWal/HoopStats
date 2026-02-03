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
    print("DIAGNOSING 504 ERROR")
    print("="*60)
    
    # Check PM2 status
    print("\n[1] PM2 status...")
    run_command(client, "pm2 status")
    
    # Check if port 5000 is listening
    print("\n[2] Checking port 5000...")
    run_command(client, "ss -tlnp | grep 5000")
    
    # Check recent PM2 error logs
    print("\n[3] Recent error logs...")
    run_command(client, "pm2 logs hoopstats --lines 30 --nostream")
    
    # Check memory usage
    print("\n[4] Memory usage...")
    run_command(client, "free -h")
    
    # Restart PM2 if needed
    print("\n[5] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    import time
    time.sleep(5)
    
    # Test health endpoint
    print("\n[6] Testing health endpoint...")
    run_command(client, "curl -s http://localhost:5000/api/health")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
