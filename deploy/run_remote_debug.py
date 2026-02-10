import paramiko
import time

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

# The debug script to run remotely
DEBUG_SCRIPT = """
import sys
import os
import pandas as pd
import json

# Add project path to sys.path
sys.path.append('/var/www/hoopstats')
sys.path.append('/var/www/hoopstats/server/nba-prop-model')

try:
    from src.data.nba_api_client import NBADataClient
    
    print("Initializing client...")
    client = NBADataClient()
    
    pid = 2544 # LeBron
    print(f"Fetching game log for player {pid}...")
    
    df = client.get_player_game_log(pid, season="2025-26")
    if not df.empty:
        print(f"Columns: {list(df.columns)}")
        print(f"First Row: {df.iloc[0].to_dict()}")
        if 'TEAM_ABBREVIATION' in df.columns:
            print(f"TEAM_ABBREVIATION: {df.iloc[0]['TEAM_ABBREVIATION']}")
        else:
            print("TEAM_ABBREVIATION NOT FOUND")
    else:
        print("DataFrame is empty (no games found)")

    print("-" * 20)
    print("Fetching Player Info...")
    info = client.get_player_info(pid)
    print(f"Info Keys: {list(info.keys())}")
    print(f"TEAM_ABBREVIATION from Info: {info.get('TEAM_ABBREVIATION', 'NOT FOUND')}")
    print(f"TEAM_NAME from Info: {info.get('TEAM_NAME', 'NOT FOUND')}")

except Exception as e:
    print(f"Error: {e}")
"""

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Write script to tmp
        print("Writing debug script to /tmp/debug_nba.py...")
        sftp = client.open_sftp()
        with sftp.file("/tmp/debug_nba.py", "w") as f:
            f.write(DEBUG_SCRIPT)
        sftp.close()

        # Run it
        print("Running script...")
        cmd = "/usr/bin/python3 /tmp/debug_nba.py"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        print(stdout.read().decode('utf-8', errors='replace'))
        err = stderr.read().decode('utf-8', errors='replace')
        if err:
            print(f"STDERR: {err}")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
