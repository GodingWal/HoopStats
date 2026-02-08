import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko
import json

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check current bets data
print('=== Checking /api/bets ===')
cmd = 'curl -s http://localhost:5000/api/bets | python3 -c "import json,sys; bets=json.load(sys.stdin); print(f\'Bets count: {len(bets)}\'); [print(json.dumps(b, indent=2)) for b in bets[:2]]"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Also check if signal loading is working
print('\n=== Checking server logs for SignalScoring ===')
cmd = 'pm2 logs hoopstats --nostream --lines 30 2>&1 | grep -i "signal" || echo "No signal logs found"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
