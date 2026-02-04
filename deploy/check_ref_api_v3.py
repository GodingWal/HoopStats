import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

script_content = """
from nba_api.stats.endpoints import boxscoresummaryv2, scoreboardv2
import pandas as pd

# Try to find a 2026 game
print("Fetching Scoreboard for 2026-02-01...")
try:
    board = scoreboardv2.ScoreboardV2(game_date='2026-02-01').get_data_frames()[0]
    if not board.empty:
        game_id = board['GAME_ID'].iloc[0]
        print(f"Found Game ID: {game_id}")
        
        print("Checking BoxScoreSummaryV2...")
        try:
            summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id).get_data_frames()
            print(f"V2 DataFrames: {len(summary)}")
            for i, df in enumerate(summary):
                print(f"  DF{i} Columns: {df.columns.tolist()}")
                if 'OFFICIAL_ID' in df.columns:
                    print(df.head())
        except Exception as e:
            print(f"V2 Error: {e}")
            
    else:
        print("No games found for 2026-02-01")

except Exception as e:
    print(f"Scoreboard Error: {e}")
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/check_ref_api_v3.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/check_ref_api_v3.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
