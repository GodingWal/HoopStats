import paramiko
import sys
import json

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("Checking ALL players for null season_averages...")
cmd = "curl -s 'http://localhost:5000/api/players'"
stdin, stdout, stderr = client.exec_command(cmd)
response = stdout.read().decode().strip()

try:
    data = json.loads(response)
    if isinstance(data, list):
        print(f"Total Players: {len(data)}")
        null_avg_count = 0
        for p in data:
            if p.get('season_averages') is None:
                null_avg_count += 1
                if null_avg_count <= 5:
                    print(f"Details for {p.get('player_name')}: season_averages={p.get('season_averages')}")
            else:
                # Check if properties exist
                avgs = p.get('season_averages')
                if 'REB' not in avgs or 'AST' not in avgs or 'PTS' not in avgs:
                    print(f"Details for {p.get('player_name')}: Missing Keys in averages: {avgs.keys()}")

        print(f"Players with NULL season_averages: {null_avg_count}")
    else:
        print("Not a list")
except Exception as e:
    print(f"Error: {e}")

client.close()
