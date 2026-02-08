import sys
sys.stdout.reconfigure(encoding='utf-8')
import paramiko

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('76.13.100.125', username='root', password='Wittymango520@', timeout=30)

# Check signal_weights table structure and data
print('=== Signal weights table structure ===')
cmd = '''cd /var/www/hoopstats && source server/nba-prop-model/venv/bin/activate && set -a && source .env && set +a && python3 << 'PYEOF'
import os
import psycopg2

conn = psycopg2.connect(os.environ["DATABASE_URL"])
cur = conn.cursor()

# Check table structure
cur.execute("""
    SELECT column_name, data_type FROM information_schema.columns 
    WHERE table_name = 'signal_weights'
    ORDER BY ordinal_position
""")
print("Columns:")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]}")

# Check data
print("\\nData in signal_weights:")
cur.execute("SELECT * FROM signal_weights LIMIT 5")
cols = [desc[0] for desc in cur.description]
print(cols)
for row in cur.fetchall():
    print(row[:3], "...")  # Just first 3 columns to avoid too much output

conn.close()
PYEOF
'''
stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

# Verify the API exposes these weights
print('\n\n=== Checking /api/backtest/weights endpoint ===')
cmd = 'curl -s http://localhost:5000/api/backtest/weights | head -100'
stdin, stdout, stderr = client.exec_command(cmd, timeout=30)
print(stdout.read().decode('utf-8', errors='replace')[:2000])

client.close()
