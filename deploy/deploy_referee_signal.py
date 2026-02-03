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
    print("DEPLOYING REFEREE SIGNAL UPDATES")
    print("="*60)
    
    # 1. Upload updated files
    # cron_jobs.py
    local_cron = os.path.join(BASE_DIR, "server", "nba-prop-model", "scripts", "cron_jobs_referee.py")
    remote_cron = "/var/www/hoopstats/server/nba-prop-model/scripts/cron_jobs.py"
    upload_file(sftp, local_cron, remote_cron)
    
    # referee_impact.py
    local_sig = os.path.join(BASE_DIR, "server", "nba-prop-model", "src", "signals", "referee_impact.py")
    remote_sig = "/var/www/hoopstats/server/nba-prop-model/src/signals/referee_impact.py"
    upload_file(sftp, local_sig, remote_sig)
    
    # signals/__init__.py
    local_init = os.path.join(BASE_DIR, "server", "nba-prop-model", "src", "signals", "__init__.py")
    remote_init = "/var/www/hoopstats/server/nba-prop-model/src/signals/__init__.py"
    upload_file(sftp, local_init, remote_init)
    
    # nba_api_client.py
    local_client = os.path.join(BASE_DIR, "server", "nba-prop-model", "src", "data", "nba_api_client.py")
    remote_client = "/var/www/hoopstats/server/nba-prop-model/src/data/nba_api_client.py"
    upload_file(sftp, local_client, remote_client)
    
    sftp.close()
    
    # 2. Trigger actuals to populate referee history for past games
    # We need to run it for a date that has games completed. 
    # Yesterday is good.
    print("\n[2] Running ACTUALS to populate referee data...")
    # Source .env is critical
    cmd = "cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py actuals"
    run_command(client, cmd)
    
    # 3. Verify referees table
    print("\n[3] Verifying data in referees table...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT COUNT(*) as refs, AVG(avg_fouls_per_game) as avg_fouls FROM referees;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT * FROM referees LIMIT 5;" """)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
