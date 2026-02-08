import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko
import time

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check environment for ScraperAPI key
print('=== Checking for ScraperAPI Key ===')
cmd = 'cd /var/www/hoopstats && cat ecosystem.config.cjs | grep -E "SCRAPER|PROXY" || echo "Not found in ecosystem.config.cjs"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

# Also check .env
print('\n=== Checking .env ===')
cmd = 'cd /var/www/hoopstats && cat .env 2>/dev/null | grep -E "SCRAPER|PROXY" || echo "Not found in .env"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

# Check PM2 environment
print('\n=== PM2 Environment ===')
cmd = 'pm2 env 0 2>&1 | grep -E "SCRAPER|PROXY" || echo "Not set in PM2 env"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

# Wait and check for a new scraping attempt
print('\n=== Clearing cache and triggering refresh... ===')
cmd = 'curl -s -X POST "http://localhost:5000/api/bets/refresh" 2>/dev/null || echo "Refresh failed"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=120, get_pty=True)
# Don't wait for full response, just trigger

time.sleep(10)

# Check logs after refresh
print('\n=== PM2 Logs after refresh attempt ===')
cmd = 'pm2 logs hoopstats --nostream --lines 20 2>&1 | tail -20'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
