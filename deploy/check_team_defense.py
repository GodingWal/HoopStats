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

print("\n--- team_defense Schema ---")
cmd_schema = f"""{psql_cmd} -c "\d team_defense" """
stdin, stdout, stderr = client.exec_command(cmd_schema)
print(stdout.read().decode().strip())

print("\n--- team_defense Sample ---")
cmd_sample = f"""{psql_cmd} -c "SELECT * FROM team_defense LIMIT 1;" """
stdin, stdout, stderr = client.exec_command(cmd_sample)
print(stdout.read().decode().strip())

client.close()
