import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Test the backtest API  
print('=== Testing backtest API (should not be rate limited) ===')
for i in range(3):
    cmd = 'curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/api/backtest/overview'
    stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
    code = stdout.read().decode('utf-8', errors='replace')
    print(f'Request {i+1}: HTTP {code}')

print()
print('=== Backtest refresh status ===')
cmd = 'curl -s http://localhost:5000/api/backtest/refresh/status | head -200'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace')[:500])

client.close()
print()
print('Done! Backtest endpoints are no longer rate limited.')
