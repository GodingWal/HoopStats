import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=120):
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
    print("QUICK REDEPLOY WITH JS RENDERING")
    print("="*60)
    
    # Pull, install, build
    print("\n[1] Pull, install, build...")
    run_command(client, "cd /var/www/hoopstats && git pull && npm install && npm run build")
    
    # Restart PM2
    print("\n[2] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    # Wait for startup
    time.sleep(10)
    
    # Test the PrizePicks endpoint
    print("\n[3] Testing PrizePicks endpoint...")
    run_command(client, "curl -s 'http://localhost:5000/api/prizepicks/projections' | head -c 2000")
    
    # Check logs
    print("\n[4] Recent logs...")
    run_command(client, "pm2 logs hoopstats --lines 15 --nostream")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
