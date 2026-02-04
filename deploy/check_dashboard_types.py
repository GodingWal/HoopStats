import paramiko
import sys
import json

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

def check_endpoint(name, url):
    print(f"\nChecking {name} ({url})...")
    cmd = f"curl -s 'http://localhost:5000{url}'"
    stdin, stdout, stderr = client.exec_command(cmd)
    response = stdout.read().decode().strip()
    try:
        data = json.loads(response)
        if isinstance(data, list):
            if data:
                item = data[0]
                print("First Item Keys:", item.keys())
                for k in ['hit_rate', 'edge_score', 'line']:
                    if k in item:
                        print(f"  {k}: {item[k]} (Type: {type(item[k])})")
            else:
                print("Empty List")
        elif isinstance(data, dict):
            # Track record
            print("Keys:", data.keys())
            for k in ['hitRate', 'roi', 'profit']:
                if k in data:
                    print(f"  {k}: {data[k]} (Type: {type(data[k])})")
        else:
            print("Unknown type:", type(data))
    except Exception as e:
        print(f"Error parsing {name}: {e}")
        print("Response start:", response[:200])

check_endpoint("Top Picks", "/api/bets/top-picks")
check_endpoint("Track Record", "/api/track-record?days=30")
check_endpoint("Players", "/api/players")

client.close()
