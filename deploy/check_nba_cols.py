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
from nba_api.stats.endpoints import leaguedashteamstats
import pandas as pd

print("Fetching Base stats...")
try:
    df_base = leaguedashteamstats.LeagueDashTeamStats(season='2024-25').get_data_frames()[0]
    print("Base Columns:", df_base.columns.tolist())
except Exception as e:
    print(f"Base Error: {e}")

print("\\nFetching Opponent stats (measure_type='Opponent')...")
try:
    df_opp = leaguedashteamstats.LeagueDashTeamStats(season='2024-25', measure_type_detailed_defense='Opponent').get_data_frames()[0]
    print("Opp Columns:", df_opp.columns.tolist())
except Exception as e:
    print(f"Opponent Error: {e}")
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/check_cols.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/check_cols.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
