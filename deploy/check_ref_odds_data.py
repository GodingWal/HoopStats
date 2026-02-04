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
stdin, stdout, stderr = client.exec_command(cmd_env)
env_content = stdout.read().decode()
db_url = ""
for line in env_content.split('\n'):
    if line.startswith("DATABASE_URL="):
        db_url = line.split("=", 1)[1].strip().strip('"').strip("'")
        break

psql_cmd = f"""psql "{db_url}" """

print("\n--- Game Referees Sample ---")
cmd_ref = f"""{psql_cmd} -c "SELECT * FROM game_referees LIMIT 5;" """
stdin, stdout, stderr = client.exec_command(cmd_ref)
print(stdout.read().decode().strip())

print("\n--- Line Movements Sample ---")
cmd_lines = f"""{psql_cmd} -c "SELECT * FROM line_movements LIMIT 5;" """
stdin, stdout, stderr = client.exec_command(cmd_lines)
print(stdout.read().decode().strip())

print("\n--- PrizePicks Line Movements Sample ---")
cmd_pp_lines = f"""{psql_cmd} -c "SELECT * FROM prizepicks_line_movements LIMIT 5;" """
stdin, stdout, stderr = client.exec_command(cmd_pp_lines)
print(stdout.read().decode().strip())

client.close()
