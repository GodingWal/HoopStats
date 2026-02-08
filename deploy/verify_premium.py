import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check latest PM2 logs
print('=== Latest PM2 Error Logs ===')
cmd = 'pm2 logs hoopstats --nostream --lines 50 2>&1 | grep -E "ScraperAPI|premium|ultra" | tail -10'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Check if the fix is actually deployed by looking at the source
print('\n=== Checking deployed code for premium parameter ===')
cmd = 'grep -n "premium" /var/www/hoopstats/dist/index.cjs | head -5'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

# Also check latest all logs
print('\n=== Latest all logs ===')
cmd = 'pm2 logs hoopstats --nostream --lines 30 2>&1 | tail -30'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
