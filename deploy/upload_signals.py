import paramiko
import sys
import os
import glob

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
sftp = client.open_sftp()

local_signals_dir = r"c:\Users\Goding Wal\Desktop\Hoop-Stats\server\nba-prop-model\src\signals"
remote_signals_dir = "/var/www/hoopstats/server/nba-prop-model/src/signals"

# Upload all .py files in signals dir
files = glob.glob(os.path.join(local_signals_dir, "*.py"))
for file_path in files:
    filename = os.path.basename(file_path)
    remote_path = f"{remote_signals_dir}/{filename}"
    print(f"Uploading {filename} -> {remote_path}")
    sftp.put(file_path, remote_path)

sftp.close()
client.close()
print("Signals upload complete.")
