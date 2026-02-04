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

print("Checking API locally...")
cmd_curl = "curl -s 'http://localhost:3000/api/backtest/signals?statType=Points&days=30'"
stdin, stdout, stderr = client.exec_command(cmd_curl)
response = stdout.read().decode()

try:
    data = json.loads(response)
    print(f"Signals found: {len(data.get('signals', []))}")
    for s in data.get('signals', [])[:5]:
        print(f"  {s['signalName']}: {s['accuracy']:.1%} ({s['totalPredictions']})")
except Exception as e:
    print(f"Error parsing JSON: {e}")
    print(f"Raw response: {response[:500]}...")

client.close()
