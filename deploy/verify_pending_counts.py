import paramiko
import sys
import time

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"
VENV_PYTHON = f"{REMOTE_DIR}/server/nba-prop-model/venv/bin/python"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        verify_script = """
import psycopg2
import os
import sys

try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    cur.execute("SELECT to_char(game_date, 'YYYY-MM-DD'), COUNT(*) FROM projection_logs WHERE actual_value IS NULL AND game_date < CURRENT_DATE GROUP BY 1 ORDER BY 1")
    rows = cur.fetchall()
    print("Pending Actuals by Date:")
    for row in rows:
        print(f"{row[0]}: {row[1]}")
    if not rows:
        print("No pending actuals found!")
except Exception as e:
    print(f"Error: {e}")
"""
        
        print("Running verification...")
        # Write script to file
        sftp = client.open_sftp()
        with sftp.file(f"{REMOTE_DIR}/server/nba-prop-model/verify_pending.py", 'w') as f:
            f.write(verify_script)
        sftp.close()
        
        # Run it
        cmd = f"cd {REMOTE_DIR} && set -a && source .env && set +a && cd server/nba-prop-model && {VENV_PYTHON} verify_pending.py && rm verify_pending.py"
        
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        err = stderr.read().decode()
        if err:
            print(f"Stderr: {err}")
            
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
