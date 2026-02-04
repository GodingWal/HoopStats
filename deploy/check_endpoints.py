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
try:
    from nba_api.stats.endpoints import boxscoresummaryv3
    print("BoxScoreSummaryV3: Available")
except ImportError:
    print("BoxScoreSummaryV3: Not found")

try:
    from nba_api.stats.endpoints import boxscoretraditionalv2
    print("BoxScoreTraditionalV2: Available")
except ImportError:
    print("BoxScoreTraditionalV2: Not found")
    
# Test TraditionalV2 for Referees
from nba_api.stats.endpoints import boxscoretraditionalv2
try:
    # Game ID: 0022500702 (Feb 1 2026)
    box = boxscoretraditionalv2.BoxScoreTraditionalV2(game_id='0022500702').get_data_frames()
    print(f"TraditionalV2 DataFrames: {len(box)}")
    # Usually DF[0]=PlayerStats, DF[1]=TeamStats, DF[2]=StartersBench?
    # Where are refs?
    # Maybe BoxScoreMatchups?
    # Or just inspecting all frames.
    for i, df in enumerate(box):
         print(f"  DF{i} Columns: {df.columns.tolist()}")
         if 'OFFICIAL_ID' in df.columns or 'FIRST_NAME' in df.columns:
             print(f"  Referees found in DF{i}")
             print(df.head())
except Exception as e:
    print(f"TraditionalV2 Error: {e}")

"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/check_endpoints.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/check_endpoints.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
