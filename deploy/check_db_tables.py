import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check backtest-related tables
print('=== Checking backtest data ===')
cmd = """cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python3 << 'PYEOF'
import os
import psycopg2

conn = psycopg2.connect(os.environ['DATABASE_URL'])
cur = conn.cursor()

# Check projection_logs
cur.execute('SELECT COUNT(*), MAX(captured_at) FROM projection_logs')
count, last = cur.fetchone()
print(f'projection_logs: {count} rows, last capture: {last}')

# Check signal_performance
cur.execute('SELECT COUNT(*) FROM signal_performance')
count = cur.fetchone()[0]
print(f'signal_performance: {count} rows')

# Check backtest_runs 
cur.execute('SELECT COUNT(*), MAX(end_date) FROM backtest_runs')
count, last = cur.fetchone()
print(f'backtest_runs: {count} rows, last run: {last}')

# Check recent projection_logs
cur.execute("SELECT COUNT(*) FROM projection_logs WHERE captured_at > NOW() - INTERVAL '24 hours'")
recent = cur.fetchone()[0]
print(f'projection_logs in last 24h: {recent}')

# Check projection_logs with actuals
cur.execute("SELECT COUNT(*) FROM projection_logs WHERE actual_value IS NOT NULL")
with_actuals = cur.fetchone()[0]
print(f'projection_logs with actuals: {with_actuals}')

# Check hit rate
if with_actuals > 0:
    cur.execute("SELECT COUNT(*) FROM projection_logs WHERE actual_value IS NOT NULL AND hit = true")
    hits = cur.fetchone()[0]
    print(f'Hit rate: {hits}/{with_actuals} = {hits/with_actuals*100:.1f}%')

conn.close()
PYEOF
"""
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Check the backtest API
print('\n=== Checking backtest API ===')
cmd = 'curl -s http://localhost:5000/api/backtest/summary 2>&1 | head -100'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace'))

client.close()
