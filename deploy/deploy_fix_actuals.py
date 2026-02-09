import paramiko
import sys
import time
import socket

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"
VENV_PYTHON = f"{REMOTE_DIR}/server/nba-prop-model/venv/bin/python"
VENV_PIP = f"{REMOTE_DIR}/server/nba-prop-model/venv/bin/pip"

def run_command(client, command, timeout=300):
    """Run a command with proper timeout handling using channels."""
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print(f"Timeout: {timeout}s")
    print('='*60)
    
    # Use transport channel for better timeout control
    transport = client.get_transport()
    channel = transport.open_session()
    channel.settimeout(timeout)
    
    try:
        channel.exec_command(command)
        
        # Read output with timeout
        stdout_data = b''
        stderr_data = b''
        
        start_time = time.time()
        while True:
            # Check if we've exceeded timeout
            elapsed = time.time() - start_time
            if elapsed > timeout:
                print(f"Command timed out after {timeout}s")
                channel.close()
                return False
            
            # Check if command is done
            if channel.exit_status_ready():
                # Read any remaining data
                while channel.recv_ready():
                    stdout_data += channel.recv(4096)
                while channel.recv_stderr_ready():
                    stderr_data += channel.recv_stderr(4096)
                break
            
            # Read available data (non-blocking due to timeout)
            try:
                if channel.recv_ready():
                    chunk = channel.recv(4096)
                    stdout_data += chunk
                    # Print output in real-time
                    print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
                if channel.recv_stderr_ready():
                    stderr_data += channel.recv_stderr(4096)
            except socket.timeout:
                continue
            
            time.sleep(0.1)
        
        exit_code = channel.recv_exit_status()
        
        # Print any remaining output
        out = stdout_data.decode('utf-8', errors='replace').strip()
        err = stderr_data.decode('utf-8', errors='replace').strip()
        
        if err:
            print(f"\nStderr:\n{err}")
        print(f"\nExit code: {exit_code}")
        
        channel.close()
        return exit_code == 0
        
    except socket.timeout:
        print(f"Socket timeout after {timeout}s")
        channel.close()
        return False
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        channel.close()
        return False

def main():
    print(f"Connecting to {HOST}...")
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected successfully!")
        
        # Step 1: Git sync
        print("\n[1/4] Syncing with GitHub...")
        if not run_command(client, f"cd {REMOTE_DIR} && git fetch --all && git reset --hard origin/main", timeout=60):
            print("WARNING: Git sync had issues")
        
        # Step 2: Install Python dependencies
        print("\n[2/4] Installing Python dependencies (psycopg2)...")
        # Ensure we install into the venv
        run_command(client, f"{VENV_PIP} install -r {REMOTE_DIR}/server/nba-prop-model/requirements.txt", timeout=300)
        
        # Step 3: Run actuals update script
        print("\n[3/4] running actuals update script (all pending dates)...")
        
        # Create a python script file on the VPS to avoid quoting hell
        get_dates_script = """
import psycopg2
import os
import sys

try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute("SELECT DISTINCT to_char(game_date, 'YYYY-MM-DD') FROM projection_logs WHERE actual_value IS NULL AND game_date < CURRENT_DATE ORDER BY 1")
    dates = [row[0] for row in cur.fetchall()]
    print(' '.join(dates))
except Exception as e:
    # Print error to stderr but don't fail hard, just print empty
    sys.stderr.write(f"Error: {e}\\n")
"""
        # We need to write this to a file. 
        # We can use a simple echo, but we need to be careful with newlines.
        # Cat with heredoc is better if we were in bash, but here we are in python using paramiko.
        # Paramiko has sftp.
        
        print("Uploading helper script...")
        sftp = client.open_sftp()
        with sftp.file(f"{REMOTE_DIR}/server/nba-prop-model/get_pending_dates.py", 'w') as f:
            f.write(get_dates_script)
        sftp.close()
        
        # Now run the command
        cmd = f"""cd {REMOTE_DIR} && set -a && source .env && set +a && cd server/nba-prop-model && \\
dates=$({VENV_PYTHON} get_pending_dates.py) && \\
echo "Found pending dates: $dates" && \\
if [ -n "$dates" ]; then \\
  for date in $dates; do \\
    echo "Processing $date..." && \\
    {VENV_PYTHON} scripts/cron_jobs.py actuals --date $date; \\
  done; \\
else \\
  echo "No pending dates found."; \\
fi && \\
rm get_pending_dates.py"""

        run_command(client, cmd, timeout=1200)
        
        # Step 4: Restart PM2 (to be safe, in case app needs fresh env or code)
        print("\n[4/4] Restarting PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats", timeout=60)
        
        print("\n" + "="*60)
        print("DEPLOYMENT COMPLETE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
