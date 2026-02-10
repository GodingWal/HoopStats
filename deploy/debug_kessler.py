import paramiko

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

# The debug script to run remotely
DEBUG_SCRIPT = """
import sys
import pandas as pd
sys.path.append('/var/www/hoopstats')
sys.path.append('/var/www/hoopstats/server/nba-prop-model')

from src.data.nba_api_client import NBADataClient

def main():
    client = NBADataClient()
    
    # Walker Kessler
    # Get ID first
    # Or just use name search
    from nba_api.stats.static import players
    p_list = players.find_players_by_full_name("Walker Kessler")
    if not p_list:
        print("Walker Kessler not found in static list")
        return
    pid = p_list[0]['id']
    print(f"Walker Kessler ID: {pid}")
    
    # Get game log
    print("Fetching game log...")
    df = client.get_player_game_log(pid, season="2025-26")
    
    if df.empty:
        print("Game log EMPTY")
        return

    print(f"Columns: {list(df.columns)}")
    row = df.iloc[0]
    print(f"First Row: {row.to_dict()}")
    
    if 'MATCHUP' in df.columns:
        m = row['MATCHUP']
        print(f"MATCHUP value: '{m}'")
        if m:
            parsed = m.split(' ')[0]
            print(f"Parsed Team: '{parsed}'")
    else:
        print("MATCHUP column missing")

if __name__ == "__main__":
    main()
"""

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Write script to tmp
        sftp = client.open_sftp()
        with sftp.file("/tmp/debug_kessler.py", "w") as f:
            f.write(DEBUG_SCRIPT)
        sftp.close()

        # Run it
        print("Running script...")
        cmd = "/usr/bin/python3 /tmp/debug_kessler.py"
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
