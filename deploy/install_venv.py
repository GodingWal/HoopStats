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
    print("INSTALLING PYTHON3-VENV AND SETTING UP")
    print("="*60)
    
    # Install python3-venv
    print("\n[1] Installing python3-venv...")
    run_command(client, "apt-get install -y python3-venv python3.12-venv")
    
    # Remove failed venv and recreate
    print("\n[2] Creating Python virtual environment...")
    run_command(client, "rm -rf /var/www/hoopstats/venv")
    run_command(client, "cd /var/www/hoopstats && python3 -m venv venv")
    
    # Install dependencies
    print("\n[3] Installing Python dependencies...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install --upgrade pip")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && pip install psycopg2-binary requests python-dotenv pandas numpy")
    
    # Check if cron_jobs.py needs additional dependencies
    print("\n[4] Checking cron_jobs.py imports...")
    run_command(client, "head -30 /var/www/hoopstats/server/nba-prop-model/scripts/cron_jobs.py")
    
    # Run capture
    print("\n[5] Running CAPTURE...")
    run_command(client, "cd /var/www/hoopstats && source venv/bin/activate && python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
