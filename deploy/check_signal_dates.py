import paramiko
import sys
import json

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

cmd_env = "cat /var/www/hoopstats/.env"
stdin, stdout, stderr = client.exec_command(cmd_env)
env_content = stdout.read().decode()
db_url = ""
for line in env_content.split('\n'):
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break

psql_cmd = f"""psql "{db_url}" """

print("\n--- Signal Performance Dates ---")
cmd_date = f"""{psql_cmd} -c "SELECT MAX(evaluation_date) as max_date, MIN(evaluation_date) as min_date, COUNT(*) FROM signal_performance;" """
stdin, stdout, stderr = client.exec_command(cmd_date)
print(stdout.read().decode().strip())

print("\n--- Recent Records ---")
cmd_recent = f"""{psql_cmd} -c "SELECT signal_name, stat_type, evaluation_date FROM signal_performance ORDER BY evaluation_date DESC LIMIT 5;" """
stdin, stdout, stderr = client.exec_command(cmd_recent)
print(stdout.read().decode().strip())

client.close()
