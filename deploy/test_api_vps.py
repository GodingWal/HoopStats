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

print("Testing API /api/backtest/signals...")
cmd = "curl -s http://localhost:5000/api/backtest/signals?statType=Points"
stdin, stdout, stderr = client.exec_command(cmd)
response = stdout.read().decode().strip()
print(f"Response length: {len(response)}")
try:
    data = json.loads(response)
    print("Signals count:", len(data.get('signals', [])))
    if data.get('signals'):
        print("Sample signal:", data['signals'][0])
except:
    print("Raw response:", response[:500])

print("\nTesting API /api/backtest/overview...")
cmd = "curl -s http://localhost:5000/api/backtest/overview"
stdin, stdout, stderr = client.exec_command(cmd)
response = stdout.read().decode().strip()
try:
    data = json.loads(response)
    print("Total Projections:", data.get('totalProjections'))
except:
    print("Raw response:", response[:500])

client.close()
