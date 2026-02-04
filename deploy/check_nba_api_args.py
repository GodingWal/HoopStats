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
import inspect

print("Arguments for LeagueDashTeamStats:")
sig = inspect.signature(leaguedashteamstats.LeagueDashTeamStats.__init__)
for name, param in sig.parameters.items():
    print(f"  {name}")
"""

sftp = client.open_sftp()
with sftp.file("/var/www/hoopstats/server/nba-prop-model/scripts/check_args.py", "w") as f:
    f.write(script_content)
sftp.close()

print("Running check...")
cmd_run = "python3 /var/www/hoopstats/server/nba-prop-model/scripts/check_args.py"
stdin, stdout, stderr = client.exec_command(cmd_run)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
