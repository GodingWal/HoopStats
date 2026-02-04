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
from nba_api.stats.endpoints import boxscoresummaryv2
import pandas as pd

# Use a recent game ID (e.g. from Feb 1st)
# Finding a game ID from game_logs or score?
# Let's try to fetch scoreboard first or just pick a known one if possible.
# Using Scoreboard to get a valid GameID
from nba_api.stats.endpoints import scoreboardv2
print("Fetching Scoreboard...")
board = scoreboardv2.ScoreboardV2(game_date='2025-02-01').get_data_frames()[0]
game_id = board['GAME_ID'].iloc[0]
print(f"Using Game ID: {game_id}")

print("Fetching BoxScoreSummary...")
summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id).get_data_frames()

# Usually Officials is one of the dataframes
for i, df in enumerate(summary):
    print(f"\\n--- DataFrame {i} Columns: {df.columns.tolist()} ---")
    if 'OFFICIAL_ID' in df.columns or 'FIRST_NAME' in df.columns:
        print(df.head())
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/check_ref_api.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/check_ref_api.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
