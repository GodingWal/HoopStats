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
    print("TESTING PUPPETEER WITH PRIZEPICKS")
    print("="*60)
    
    # Restart PM2
    print("\n[1] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    # Wait for startup
    print("\n[2] Waiting 25 seconds for Puppeteer to fetch data...")
    time.sleep(25)
    
    # Test endpoint
    print("\n[3] Testing PrizePicks endpoint...")
    run_command(client, "curl -s 'http://localhost:5000/api/prizepicks/projections' | head -c 2000")
    
    # Check logs
    print("\n[4] Checking logs for Puppeteer activity...")
    run_command(client, "pm2 logs hoopstats --lines 40 --nostream")
    
    client.close()
    print("\n" + "="*60)
    print("TEST COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
