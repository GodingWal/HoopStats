import paramiko
import sys
import time

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
    print("HARD RESET & CHECK")
    print("="*60)
    
    # 1. Run test.cjs manually and check output
    print("\n[1] Running Puppeteer test manually...")
    run_command(client, "cd /var/www/hoopstats && node test.cjs")
    
    # 2. Delete and Start PM2
    print("\n[2] Hard Reset PM2...")
    run_command(client, "pm2 delete hoopstats")
    run_command(client, "cd /var/www/hoopstats && pm2 start ecosystem.config.cjs")
    
    # 3. Check Status
    print("\n[3] Checking status...")
    run_command(client, "pm2 status hoopstats")
    
    # 4. Check Logs for Puppeteer init
    print("\n[4] Checking new logs...")
    time.sleep(5)
    run_command(client, "grep 'Using Puppeteer' /root/.pm2/logs/hoopstats-out.log | tail -n 5")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
