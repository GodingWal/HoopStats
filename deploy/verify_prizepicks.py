import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Wait a moment for the app to initialize
time.sleep(3)

# Check recent PM2 logs for scraping attempts
print('=== Recent PM2 Logs (last 30 lines) ===')
cmd = 'pm2 logs hoopstats --nostream --lines 30 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Test the bets refresh endpoint with a longer timeout
print('\n\n=== Testing /api/bets endpoint ===')
cmd = 'curl -s http://localhost:5000/api/bets 2>/dev/null | head -c 500'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
output = stdout.read().decode('utf-8', errors='replace')
print(f"Response: {output[:500]}")

client.close()
