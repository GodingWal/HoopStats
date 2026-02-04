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

print("Checking API locally with no-cache...")
# Use 127.0.0.1 to avoid potential localhost resolution issues (ipv6)
cmd_curl = "curl -v -H 'Cache-Control: no-cache' 'http://127.0.0.1:3000/api/backtest/signals?statType=Points&days=30'"
stdin, stdout, stderr = client.exec_command(cmd_curl)
response = stdout.read().decode()
err = stderr.read().decode()

print(f"Stderr: {err}")

try:
    if not response:
        print("Empty response body")
    else:
        data = json.loads(response)
        print(f"Signals found: {len(data.get('signals', []))}")
        for s in data.get('signals', []):
            print(f"  {s['signalName']}: {s['accuracy']:.1%} ({s['totalPredictions']})")
except Exception as e:
    print(f"Error parsing JSON: {e}")
    print(f"Raw response: {response[:500]}...")

client.close()
