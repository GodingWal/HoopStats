import paramiko
import sys
import os

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
sftp = client.open_sftp()

local_base = r"c:\Users\Goding Wal\Desktop\Hoop-Stats\server\nba-prop-model\src"
remote_base = "/var/www/hoopstats/server/nba-prop-model/src"

files_to_sync = [
    ("evaluation/backtest_engine.py", "evaluation/backtest_engine.py"),
    ("signals/defense_vs_position.py", "signals/defense_vs_position.py")
]

for local_rel, remote_rel in files_to_sync:
    local_path = os.path.join(local_base, local_rel)
    remote_path = f"{remote_base}/{remote_rel}"
    
    print(f"Uploading {local_rel} -> {remote_path}...")
    try:
        sftp.put(local_path, remote_path)
    except Exception as e:
        print(f"Failed to upload {local_rel}: {e}")

sftp.close()
client.close()
print("Deployment complete.")
