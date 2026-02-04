import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

cmd_env = "cat /var/www/hoopstats/.env"
client.exec_command(cmd_env)
# ... assume same connection logic ...
# Just simple query wrapper
cmd_check = "psql $(grep DATABASE_URL /var/www/hoopstats/.env | cut -d= -f2 | tr -d '\"') -c \"SELECT count(*) FROM games; SELECT count(*) FROM game_referees; SELECT count(*) FROM referees;\""

stdin, stdout, stderr = client.exec_command(cmd_check)
print(stdout.read().decode())
print(stderr.read().decode())

client.close()
