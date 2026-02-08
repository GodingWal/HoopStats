import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Run the weight optimizer to update weights based on backtest performance
print('=== Running weight optimizer from backtest data ===')
cmd = '''cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python server/nba-prop-model/scripts/cron_jobs.py weights 2>&1'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Verify weights were saved
print('\n\n=== Verifying signal_weights were populated ===')
cmd = '''cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python3 << 'PYEOF'
import os
import psycopg2

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

cur.execute("SELECT COUNT(*) FROM signal_weights")
count = cur.fetchone()[0]
print(f"signal_weights: {count} rows")

if count > 0:
    cur.execute("""
        SELECT signal_name, stat_type, weight, accuracy, sample_size
        FROM signal_weights 
        WHERE valid_until IS NULL
        ORDER BY stat_type, weight DESC
        LIMIT 20
    """)
    print("\\nLearned weights from backtest:")
    print("-" * 80)
    current_stat = None
    for row in cur.fetchall():
        signal, stat_type, weight, acc, n = row
        if stat_type != current_stat:
            print(f"\\n{stat_type}:")
            current_stat = stat_type
        print(f"  {signal:20} weight={weight:.3f}  accuracy={acc:.3f}  samples={n}")

conn.close()
PYEOF
'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

client.close()
