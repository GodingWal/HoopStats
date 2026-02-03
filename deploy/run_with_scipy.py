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
        print(f"Output:\n{out[:3000]}")
    if err:
        print(f"Stderr:\n{err[:1500]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("INSTALLING SCIPY AND RUNNING CRON JOBS")
    print("="*60)
    
    # Install scipy
    print("\n[1] Installing scipy...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install scipy")
    
    # Run capture
    print("\n[2] Running CAPTURE...")
    success = run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1")
    
    # Run actuals  
    print("\n[3] Running ACTUALS...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py actuals 2>&1")
    
    # Run validate
    print("\n[4] Running VALIDATE...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py validate 2>&1")
    
    # Check database tables
    print("\n[5] Checking database for backtest data...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "\\dt" | grep -i 'signal\|backtest\|prop'""")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT COUNT(*) FROM prop_signals;" 2>/dev/null || echo 'prop_signals table does not exist'""")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT relname, n_tup_ins FROM pg_stat_user_tables WHERE n_tup_ins > 0 ORDER BY n_tup_ins DESC LIMIT 10;"  """)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
