import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
DATABASE_URL = "postgres://hoopstats_user:HoopStats2026Secure!@localhost:5432/hoopstats"

def run_command(client, command, timeout=120):
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
    print("RUNNING BACKTEST MIGRATIONS")
    print("="*60)
    
    # Run migration 007
    print("\n[1] Running migration 007_create_projection_logs.sql...")
    run_command(client, "sudo -u postgres psql -d hoopstats -f /var/www/hoopstats/migrations/007_create_projection_logs.sql")
    
    # Verify tables created
    print("\n[2] Verifying backtest tables...")
    run_command(client, r"sudo -u postgres psql -d hoopstats -c \"\\dt *signal*\"")
    run_command(client, r"sudo -u postgres psql -d hoopstats -c \"\\dt *projection*\"")
    run_command(client, r"sudo -u postgres psql -d hoopstats -c \"\\dt *backtest*\"")
    
    # Now run cron jobs again
    print("\n[3] Running CAPTURE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1 | tail -30")
    
    print("\n[4] Running ACTUALS...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py actuals 2>&1 | tail -20")
    
    print("\n[5] Running VALIDATE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py validate 2>&1 | tail -30")
    
    # Check for data
    print("\n[6] Checking projection_logs table...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT COUNT(*) as projections FROM projection_logs;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT player_name, stat_type, projected_value, prizepicks_line FROM projection_logs ORDER BY captured_at DESC LIMIT 5;" """)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
