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
    print("FIXING TABLE PERMISSIONS")
    print("="*60)
    
    # Grant permissions
    print("\n[1] Granting permissions to hoopstats_user...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hoopstats_user;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hoopstats_user;" """)
    
    # Verify tables created
    print("\n[2] Verifying permissions...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'hoopstats_user' AND table_name IN ('projection_logs', 'signal_weights');" """)
    
    # Now run cron jobs again
    print("\n[3] Running CAPTURE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1")
    
    # Run validate (skip actuals as it needs previous day games usually)
    print("\n[4] Running VALIDATE...")
    run_command(client, f"cd /var/www/hoopstats && source venv/bin/activate && DATABASE_URL='{DATABASE_URL}' python server/nba-prop-model/scripts/cron_jobs.py validate 2>&1")
    
    # Check for data
    print("\n[5] Checking projection_logs table...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT COUNT(*) as projections FROM projection_logs;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "SELECT player_name, stat_type, projected_value, predicted_edge FROM projection_logs ORDER BY captured_at DESC LIMIT 5;" """)
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
