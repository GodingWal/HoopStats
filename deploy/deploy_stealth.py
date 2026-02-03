import paramiko
import sys
import time
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
BASE_DIR = r"c:\Users\Goding Wal\Desktop\Hoop-Stats"

def upload_file(sftp, local_path, remote_path):
    print(f"Uploading {local_path} -> {remote_path}")
    sftp.put(local_path, remote_path)

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
    
    sftp = client.open_sftp()
    
    print("\n" + "="*60)
    print("DEPLOYING STEALTH UPDATES")
    print("="*60)
    
    # Upload puppeteer-scraper.ts
    local_path = os.path.join(BASE_DIR, "server", "puppeteer-scraper.ts")
    remote_path = "/var/www/hoopstats/server/puppeteer-scraper.ts"
    upload_file(sftp, local_path, remote_path)
    
    sftp.close()
    
    # Rebuild (since it's TS)?
    # Need to check if I need to compile. 
    # Yes, usually 'npm run build' or similar.
    # But wait, ecosystem uses 'dist/index.cjs'.
    # So I MUST rebuild.
    
    print("\n[1] Rebuilding application...")
    run_command(client, "cd /var/www/hoopstats && npm run build")
    
    # Restart
    print("\n[2] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    # Check logs
    print("\n[3] Watching logs for Puppeteer success/fail...")
    time.sleep(10)
    # Check out log for "Using Puppeteer" and subsequent result
    cmd = "grep -A 5 'Using Puppeteer' /root/.pm2/logs/hoopstats-out-0.log | tail -n 10"
    run_command(client, cmd)
    
    # Check error log
    cmd_err = "tail -n 10 /root/.pm2/logs/hoopstats-error-0.log"
    run_command(client, cmd_err)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
