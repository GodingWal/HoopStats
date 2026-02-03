import paramiko
import sys
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

def run_command(client, command, timeout=120):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out[:2000]}")
    if err:
        print(f"Stderr:\n{err[:1000]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    sftp = client.open_sftp()
    
    print("\n" + "="*60)
    print("RUNNING REFEREE BACKFILL")
    print("="*60)
    
    # Upload script
    local_script = os.path.join(BASE_DIR, "server", "nba-prop-model", "scripts", "backfill_referees.py")
    remote_script = "/var/www/hoopstats/server/nba-prop-model/scripts/backfill_referees.py"
    upload_file(sftp, local_script, remote_script)
    
    sftp.close()
    
    # Run in background using nohup
    print("\n[1] Starting backfill process (this will take ~10 mins)...")
    # We use source venv and env vars
    cmd = "cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && nohup python server/nba-prop-model/scripts/backfill_referees.py > /var/log/hoopstats_backfill.log 2>&1 &"
    
    # We don't wait for completion, just start it
    client.exec_command(cmd)
    
    print("Backfill started in background. Logs at /var/log/hoopstats_backfill.log")
    
    # Verify it started
    run_command(client, "ps aux | grep backfill_referees.py | grep -v grep")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
