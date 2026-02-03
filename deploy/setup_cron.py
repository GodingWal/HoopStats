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
    print("SETTING UP CRON JOBS")
    print("="*60)
    
    # Verify .env exists
    print("\n[1] Verifying .env file...")
    run_command(client, "ls -l /var/www/hoopstats/.env")
    
    # Create crontab content
    # Note: Using 'set -a; source .env; set +a' to export variables from .env
    cron_content = """# HoopStats Backtest Cron Jobs
# Times are Server Time (PST)

# 1. Capture Projections (10:00 AM) - Before games start/lines lock
0 10 * * * cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py capture >> /var/log/hoopstats_capture.log 2>&1

# 2. Populate Actuals (2:00 AM) - After games complete
0 2 * * * cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py actuals >> /var/log/hoopstats_actuals.log 2>&1

# 3. Validation (3:00 AM) - Daily accuracy report
0 3 * * * cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py validate >> /var/log/hoopstats_validate.log 2>&1

# 4. Update Weights (3:30 AM Sunday) - Weekly optimization
30 3 * * 0 cd /var/www/hoopstats && source venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py weights >> /var/log/hoopstats_weights.log 2>&1
"""
    
    print("\n[2] Writing crontab file...")
    run_command(client, f"cat > /tmp/hoopstats_cron << 'EOF'\n{cron_content}\nEOF")
    
    # Install crontab
    print("\n[3] Installing crontab...")
    run_command(client, "crontab /tmp/hoopstats_cron")
    
    # Verify installation
    print("\n[4] Verifying installed cron jobs...")
    run_command(client, "crontab -l")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
