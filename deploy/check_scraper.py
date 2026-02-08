import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check environment configuration
print('=== Checking PrizePicks Scraper Configuration ===')
cmd = '''cd /var/www/hoopstats && cat .env | grep -E "PUPPETEER|SCRAPER|PROXY" 2>/dev/null || echo "No matching env vars found"'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Check if puppeteer is installed
print('\n=== Checking Puppeteer Availability ===')
cmd = '''cd /var/www/hoopstats && npm list puppeteer 2>&1 | head -5'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Check chromium availability
print('\n=== Checking Chromium ===')
cmd = 'which chromium-browser || which chromium || which google-chrome || echo "No Chrome/Chromium found"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=10)
print(stdout.read().decode('utf-8', errors='replace'))

# Check recent PM2 logs for scraper errors
print('\n=== Recent Scraper Errors ===')
cmd = 'pm2 logs hoopstats --nostream --lines 50 2>&1 | grep -E "429|blocked|ScraperAPI|Puppeteer" | tail -20'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Check scraper status endpoint
print('\n=== Scraper Status ===')
cmd = 'curl -s http://localhost:5000/api/prizepicks/status 2>/dev/null || echo "Endpoint not available"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
