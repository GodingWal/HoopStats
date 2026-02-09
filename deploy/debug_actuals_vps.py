import paramiko
import sys

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
        
        debug_script = """
import psycopg2
import os
import sys
import pandas as pd
from datetime import datetime

# Add path to find src
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data.nba_api_client import NBADataClient

try:
    conn = psycopg2.connect(os.environ['DATABASE_URL'])
    cur = conn.cursor()
    
    # Get pending projections for Feb 7
    print("Fetching sample pending projections for 2026-02-07...")
    cur.execute(\"\"\"
        SELECT player_name, game_date, stat_type, prizepicks_line 
        FROM projection_logs 
        WHERE actual_value IS NULL AND game_date = '2026-02-07'
        LIMIT 5
    \"\"\")
    rows = cur.fetchall()
    
    if not rows:
        print("No pending projections found for 2026-02-07!")
        sys.exit(0)
    
    client = NBADataClient()
    
    # Get scoreboard for Feb 7 once
    scoreboard = client.get_games_on_date('2026-02-07')
    print(f"Scoreboard has {len(scoreboard)} games")
    
    for row in rows:
        player_name, game_date, stat_type, line = row
        print(f"\\nDEBUGGING: {player_name} on {game_date}")
        
        # Check Player ID
        player_id = client.get_player_id(player_name)
        if not player_id:
            print(f"   -> Player ID not found")
            continue
            
        print(f"   -> Player ID: {player_id}")
        
        # Get Team ID
        try:
            info = client.get_player_info(player_id)
            team_id = info['TEAM_ID']
            print(f"   -> Team ID: {team_id}")
        except Exception as e:
             print(f"   -> Could not get team ID: {e}")
             continue

        # Find game in scoreboard
        game = scoreboard[(scoreboard['HOME_TEAM_ID'] == team_id) | (scoreboard['VISITOR_TEAM_ID'] == team_id)]
        if game.empty:
             print("   -> No game found for team in scoreboard")
             continue
             
        game_id = game.iloc[0]['GAME_ID']
        print(f"   -> Found Game ID: {game_id}")
        
        # Fetch Box Score
        try:
            player_stats, team_stats = client.get_box_score(game_id)
            # Find player in stats
            p_stat = player_stats[player_stats['PLAYER_ID'] == player_id]
            if not p_stat.empty:
                print(f"   -> FOUND IN BOX SCORE! Status: {p_stat.iloc[0].get('COMMENT', 'Active')}")
                print(f"   -> MIN: {p_stat.iloc[0].get('MIN')}")
                print(f"   -> PTS: {p_stat.iloc[0].get('PTS')}")
            else:
                print("   -> Player set to play but not in box score (Inactive/DNP?)")
        except Exception as e:
            print(f"   -> Error fetching box score: {e}")
    
    client = NBADataClient()
    
    # 0. Check Scoreboard for the date
    print(f"0. Checking scoreboard for {game_date}...")
    try:
        scoreboard = client.get_games_on_date(str(game_date))
        if scoreboard.empty:
            print("   -> FAILED: No games found in scoreboard for this date")
        else:
            print(f"   -> Found {len(scoreboard)} games in scoreboard")
            print(scoreboard[['GAME_DATE_EST', 'GAME_ID', 'HOME_TEAM_ID', 'VISITOR_TEAM_ID']].head().to_string())
    except Exception as e:
        print(f"   -> Error fetching scoreboard: {e}")

    # 1. Check Player ID
    player_id = client.get_player_id(player_name)
    print(f"1. Player ID search for '{player_name}': {player_id}")
    
    if not player_id:
        print("   -> FAILED: Player not found in NBA API")
        
        # Try active players search
        print("   -> Listing similar active players:")
        df = client.get_all_active_players()
        matches = df[df['full_name'].str.contains(player_name.split()[1], case=False, na=False)]
        print(matches[['id', 'full_name']].head().to_string())
        sys.exit(0)
        
    # 2. Check Game Log
    print(f"2. Fetching game log for ID {player_id}...")
    season = "2025-26" # Assuming current season
    log = client.get_player_game_log(player_id, season=season)
    
    if log.empty:
        print("   -> FAILED: No game log found")
        sys.exit(0)
        
    print(f"   -> Found {len(log)} games")
    print("   -> Recent games in log:")
    print(log[['GAME_DATE', 'MATCHUP', 'PTS', 'MIN']].head().to_string())
    
    # 3. Check Date Match
    # game_date from DB is datetime.date usually
    target_date_str = str(game_date)
    print(f"3. Looking for match with {target_date_str}")
    
    # Log dates are datetime64
    target_ts = pd.Timestamp(target_date_str)
    
    # Check for exact match
    match = log[log['GAME_DATE'] == target_ts]
    
    if not match.empty:
        print("   -> SUCCESS: Found match!")
        print(match[['GAME_DATE', 'MATCHUP', 'PTS', 'MIN']].to_string())
    else:
        print("   -> FAILED: No game found on this date")
        print(f"   Closest dates: {log['GAME_DATE'].head().tolist()}")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()

"""
        
        print("Uploading debug script...")
        sftp = client.open_sftp()
        with sftp.file(f"{REMOTE_DIR}/server/nba-prop-model/debug_actuals_remote.py", 'w') as f:
            f.write(debug_script)
        sftp.close()
        
        # Run it
        cmd = f"cd {REMOTE_DIR} && set -a && source .env && set +a && cd server/nba-prop-model && {VENV_PYTHON} debug_actuals_remote.py && rm debug_actuals_remote.py"
        
        print("Executing...")
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
