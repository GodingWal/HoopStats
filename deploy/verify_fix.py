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
    print("VERIFYING FIX")
    print("="*60)
    
    # 1. Check config
    run_command(client, "grep USE_PUPPETEER /var/www/hoopstats/ecosystem.config.cjs")
    
    # 2. Check PM2 status/uptime
    run_command(client, "pm2 status hoopstats")
    
    # 3. Check logs for "Puppeteer" initialization
    print("\nChecking logs for Puppeteer start...")
    # Grep recent logs
    run_command(client, "grep 'Using Puppeteer' /root/.pm2/logs/hoopstats-out.log | tail -n 5")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
