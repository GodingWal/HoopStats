import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

# Check last runs output
# My previous run (Step 1796) was backgrounded. Can I find the output?
# It likely died immediately if dependencies were missing.

# Run a simplified checks script
script_content = """
import sys
print(f"Python: {sys.version}")
try:
    import nba_api
    print(f"nba_api: {nba_api.__version__}")
    from nba_api.stats.endpoints import scoreboardv2
    print("Scoreboard imported")
except ImportError as e:
    print(f"ImportError: {e}")
except Exception as e:
    print(f"Error: {e}")

try:
    import sqlalchemy
    print(f"sqlalchemy: {sqlalchemy.__version__}")
except ImportError:
    print("sqlalchemy missing")
    
print("Check complete")
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/debug_env.py", "w") as f:
    f.write(script_content)
sftp.close()

stdin, stdout, stderr = client.exec_command("python3 /var/www/hoopstats/server/nba-prop-model/scripts/debug_env.py")
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
