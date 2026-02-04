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

# Check for specific tables
tables_to_check = [
    "referee_stats",
    "referee_assignments", 
    "player_injuries",
    "odds_history", 
    "game_odds"
]

print("--- Table Counts ---")
for table in tables_to_check:
    cmd_check = f"""{psql_cmd} -c "SELECT count(*) FROM {table};" """
    stdin, stdout, stderr = client.exec_command(cmd_check)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if "does not exist" in err:
        print(f"{table}: DOES NOT EXIST")
    elif "count" in out:
        # Psql output format usually:
        #  count 
        # -------
        #  123
        lines = out.split('\n')
        if len(lines) >= 3:
            count = lines[2].strip()
            print(f"{table}: {count} rows")
        else:
            print(f"{table}: Error parsing output")
    else:
        print(f"{table}: Error {err}")

print("\n--- Listing All Tables ---")
cmd_list = f"""{psql_cmd} -c "\dt" """
stdin, stdout, stderr = client.exec_command(cmd_list)
print(stdout.read().decode().strip())

client.close()
