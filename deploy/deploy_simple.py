import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Pull latest code
print('=== Pulling latest code ===')
cmd = 'cd /var/www/hoopstats && git fetch --all && git reset --hard origin/main 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))

# Install dependencies
print('\n=== Installing dependencies ===')
cmd = 'cd /var/www/hoopstats && npm install 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode('utf-8', errors='replace')[-2000:])

# Skip db:push since no schema changes - just build
print('\n=== Building app ===')
cmd = 'cd /var/www/hoopstats && npm run build 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode('utf-8', errors='replace')[-2000:])

# Restart PM2
print('\n=== Restarting PM2 ===')
cmd = 'cd /var/www/hoopstats && pm2 restart hoopstats 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

# Wait a bit and check status
import time
time.sleep(5)

print('\n=== PM2 Status ===')
cmd = 'pm2 status 2>&1'
stdin, stdout, stderr = client.exec_command(cmd, timeout=15)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
print('\n✅ Deployment complete!')
