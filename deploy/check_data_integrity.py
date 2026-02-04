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

print("\n--- Rows Count ---")
cmd_count = f"""{psql_cmd} -c "SELECT (SELECT COUNT(*) FROM players) as players_count, (SELECT COUNT(*) FROM prizepicks_daily_lines) as pp_count;" """
stdin, stdout, stderr = client.exec_command(cmd_count)
print(stdout.read().decode().strip())

print("\n--- Player Sample ---")
cmd_player = f"""{psql_cmd} -c "SELECT player_name, season_averages FROM players LIMIT 1;" """
stdin, stdout, stderr = client.exec_command(cmd_player)
print(stdout.read().decode().strip())

print("\n--- PrizePicks Sample ---")
cmd_pp = f"""{psql_cmd} -c "SELECT player_name FROM prizepicks_daily_lines ORDER BY id DESC LIMIT 1;" """
stdin, stdout, stderr = client.exec_command(cmd_pp)
print(stdout.read().decode().strip())

client.close()
