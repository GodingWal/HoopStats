import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=180):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out[:4000]}")
    if err:
        print(f"Stderr:\n{err[:2000]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("RUNNING BACKTEST CRON JOBS")
    print("="*60)
    
    # Check Python environment
    print("\n[1] Checking Python environment...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && which python && python --version")
    
    # Run capture
    print("\n[2] Running CAPTURE (today's projections)...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py capture")
    
    # Run actuals
    print("\n[3] Running ACTUALS (populate actual results)...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py actuals")
    
    # Run validate
    print("\n[4] Running VALIDATE (signal validation)...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py validate")
    
    # Check database for backtest data
    print("\n[5] Checking backtest data in database...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT COUNT(*) as signal_count FROM prop_signals;" 2>/dev/null || echo 'Table may not exist'""")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT * FROM prop_signals ORDER BY created_at DESC LIMIT 5;" 2>/dev/null || echo 'No data'""")
    
    client.close()
    print("\n" + "="*60)
    print("CRON JOBS COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
