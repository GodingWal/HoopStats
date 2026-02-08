import paramiko
import sys

sys.stdout.reconfigure(encoding='utf-8')

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

print('=== Checking backtest tables in database ===')
cmd = """cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && python3 << 'PYEOF'
import os
import psycopg2

conn = psycopg2.connect(os.environ.get('DATABASE_URL', 'postgresql://hoopstats:hoopstats123@localhost:5432/hoopstats'))
cur = conn.cursor()

# Check prop_captures
cur.execute('SELECT COUNT(*), MAX(captured_at) FROM prop_captures')
count, last = cur.fetchone()
print(f'prop_captures: {count} rows, last capture: {last}')

# Check prop_actuals
cur.execute('SELECT COUNT(*), MAX(updated_at) FROM prop_actuals')
count, last = cur.fetchone()
print(f'prop_actuals: {count} rows, last update: {last}')

# Check backtest summary for recent data
cur.execute("SELECT COUNT(*) FROM prop_captures WHERE captured_at > NOW() - INTERVAL '24 hours'")
recent = cur.fetchone()[0]
print(f'Captures in last 24h: {recent}')

# List tables
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
tables = [r[0] for r in cur.fetchall()]
print(f'Tables in DB: {len(tables)}')
for t in tables:
    print(f'  - {t}')

conn.close()
PYEOF
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

print()
print('=== Checking cron jobs ===')
cmd = 'crontab -l 2>/dev/null || echo "No crontab configured"'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
