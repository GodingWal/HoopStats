import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
DATABASE_URL = "postgres://hoopstats_user:HoopStats2026Secure!@localhost:5432/hoopstats"

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
    print("FIXING DB CONNECTION AND RUNNING CRON JOBS")
    print("="*60)
    
    # Install nba_api
    print("\n[1] Installing nba_api...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install nba_api")
    
    # Create .env file for Python scripts
    print("\n[2] Creating .env file with DATABASE_URL...")
    run_command(client, f"""cat > /var/www/hoopstats/.env << 'EOF'
DATABASE_URL={DATABASE_URL}
EOF""")
    
    # Run capture with DATABASE_URL
    print("\n[3] Running CAPTURE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1")
    
    # Run actuals  
    print("\n[4] Running ACTUALS...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py actuals 2>&1")
    
    # Run validate
    print("\n[5] Running VALIDATE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py validate 2>&1")
    
    # Check for data
    print("\n[6] Checking database tables...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT relname, n_tup_ins as rows_inserted FROM pg_stat_user_tables WHERE n_tup_ins > 0 ORDER BY n_tup_ins DESC LIMIT 15;" """)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
