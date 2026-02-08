import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Fix the crontab with correct venv path
new_crontab = """# HoopStats Backtest Cron Jobs
# Times are Server Time (PST)

# 1. Capture Projections (10:00 AM) - Before games start/lines lock
0 10 * * * cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py capture >> /var/log/hoopstats_capture.log 2>&1

# 2. Populate Actuals (2:00 AM) - After games complete
0 2 * * * cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py actuals >> /var/log/hoopstats_actuals.log 2>&1

# 3. Validation (3:00 AM) - Daily accuracy report
0 3 * * * cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py validate >> /var/log/hoopstats_validate.log 2>&1

# 4. Update Weights (3:30 AM Sunday) - Weekly optimization
30 3 * * 0 cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py weights >> /var/log/hoopstats_weights.log 2>&1
"""

print('=== Installing updated crontab ===')

# Write crontab to temp file
sftp = client.open_sftp()
with sftp.file('/tmp/hoopstats_crontab', 'w') as f:
    f.write(new_crontab)
sftp.close()

# Install the crontab
cmd = 'crontab /tmp/hoopstats_crontab && echo "Crontab installed successfully" && crontab -l'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Now manually trigger a capture to get fresh data
print('\n=== Running capture job manually ===')
cmd = 'cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py capture 2>&1 | head -100'
stdin, stdout, stderr = client.exec_command(cmd, timeout=120)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
