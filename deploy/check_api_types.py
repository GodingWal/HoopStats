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

print("Checking JSON types from API...")
cmd = "curl -s 'http://localhost:5000/api/backtest/projections?limit=5'"
stdin, stdout, stderr = client.exec_command(cmd)
response = stdout.read().decode().strip()

try:
    data = json.loads(response)
    projections = data.get('projections', [])
    if projections:
        p = projections[0]
        print(f"Sample Projection: {p['playerName']}")
        print(f"Line: {p.get('line')} (Type: {type(p.get('line'))})")
        print(f"Projected: {p.get('projectedValue')} (Type: {type(p.get('projectedValue'))})")
        print(f"Confidence: {p.get('confidenceScore')} (Type: {type(p.get('confidenceScore'))})")
        print(f"Actual: {p.get('actualValue')} (Type: {type(p.get('actualValue'))})")
    else:
        print("No projections found.")
except Exception as e:
    print(f"Error parsing JSON: {e}")
    print(response[:500])

client.close()
