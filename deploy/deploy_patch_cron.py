import paramiko
import os

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"
LOCAL_FILE = "server/nba-prop-model/scripts/cron_jobs.py"
REMOTE_FILE = f"{REMOTE_DIR}/server/nba-prop-model/scripts/cron_jobs.py"
VENV_PYTHON = f"{REMOTE_DIR}/server/nba-prop-model/venv/bin/python"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print(f"Uploading {LOCAL_FILE} to {REMOTE_FILE}...")
        sftp = client.open_sftp()
        sftp.put(LOCAL_FILE, REMOTE_FILE)
        sftp.close()
        
        print("Running actuals update for pending dates...")
        
        # Helper script to get dates again
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
    sys.stderr.write(f"Error: {e}\\n")
"""
        sftp = client.open_sftp()
        with sftp.file(f"{REMOTE_DIR}/server/nba-prop-model/get_pending_dates.py", 'w') as f:
            f.write(get_dates_script)
        sftp.close()
        
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
        
        print("Executing update...")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=1200)
        
        # Stream output
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line, end="")
            
        err = stderr.read().decode()
        if err:
            print(f"Stderr: {err}")
            
        client.close()
        print("Done.")
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
