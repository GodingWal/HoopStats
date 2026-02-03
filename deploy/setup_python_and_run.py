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
    print("SETTING UP PYTHON ENVIRONMENT")
    print("="*60)
    
    # Create venv
    print("\n[1] Creating Python virtual environment...")
    run_command(client, "cd /var/www/hoopstats && python3 -m venv venv")
    
    # Install dependencies
    print("\n[2] Installing Python dependencies...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install --upgrade pip")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install psycopg2-binary requests python-dotenv pandas numpy nba_api")
    
    # Check scripts directory
    print("\n[3] Finding cron_jobs.py...")
    run_command(client, "find /var/www/hoopstats -name 'cron_jobs.py' 2>/dev/null")
    
    # Run capture
    print("\n[4] Running CAPTURE...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py capture")
    
    # Run actuals  
    print("\n[5] Running ACTUALS...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py actuals")
    
    # Run validate
    print("\n[6] Running VALIDATE...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py validate")
    
    # Check results
    print("\n[7] Checking backtest tables...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "\\dt *signal*" 2>/dev/null || echo 'No signal tables'""")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "\\dt *backtest*" 2>/dev/null || echo 'No backtest tables'""")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
