import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Run actuals job
print('=== Running actuals job ===')
cmd = 'cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py actuals 2>&1 | tail -30'
stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode('utf-8', errors='replace'))

# Run validate job
print('\n=== Running validate job ===')
cmd = 'cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py validate 2>&1 | tail -30'
stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode('utf-8', errors='replace'))

# Check database for recent captures and actuals
print('\n=== Checking database status ===')
cmd = """cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python3 << 'PYEOF'
import os
import psycopg2

conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

# Check prop_captures
cur.execute('SELECT COUNT(*), MAX(captured_at) FROM prop_captures')
count, last = cur.fetchone()
print(f'prop_captures: {count} rows, last capture: {last}')

# Check prop_actuals
cur.execute('SELECT COUNT(*), MAX(updated_at) FROM prop_actuals')
count, last = cur.fetchone()
print(f'prop_actuals: {count} rows, last update: {last}')

# Check for recent captures
cur.execute("SELECT COUNT(*) FROM prop_captures WHERE captured_at > NOW() - INTERVAL '24 hours'")
recent = cur.fetchone()[0]
print(f'Captures in last 24h: {recent}')

# Check for validated records
cur.execute("SELECT COUNT(*) FROM prop_actuals WHERE is_validated = true")
validated = cur.fetchone()[0]
print(f'Validated records: {validated}')

conn.close()
PYEOF
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

client.close()
