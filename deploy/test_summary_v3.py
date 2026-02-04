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
from nba_api.stats.endpoints import boxscoresummaryv3
import pandas as pd

try:
    print("Checking BoxScoreSummaryV3 for 0022500702...")
    # SummaryV3 often returns a dict with 'boxScoreSummary' key, not just dataframes directly?
    # Or get_data_frames() works?
    
    endpoint = boxscoresummaryv3.BoxScoreSummaryV3(game_id='0022500702')
    # Try get_dict() to see structure first?
    data = endpoint.get_dict()
    print(f"Keys: {data.keys()}")
    
    try:
        dfs = endpoint.get_data_frames()
        print(f"DataFrames: {len(dfs)}")
        for i, df in enumerate(dfs):
            print(f"  DF{i} Columns: {df.columns.tolist()}")
            if 'officialId' in df.columns or 'officialId' in str(df.columns) or 'personId' in df.columns:
                 print(df.head())
            if 'firstName' in df.columns:
                 print(df.head())
            # V3 usually uses camelCase keys
    except Exception as e:
        print(f"get_data_frames error: {e}")

except Exception as e:
    print(f"Error: {e}")
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/test_summary_v3.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/test_summary_v3.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
