import paramiko
import time

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Checking DB Counts ===")
        # Check players count and recent_games population
        cmd = 'su - postgres -c "psql hoopstats -c \\"SELECT count(*) as total_players, count(recent_games) as players_with_games FROM players;\\""'
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        print(stderr.read().decode())

        print("=== Check a sample player ===")
        cmd = 'su - postgres -c "psql hoopstats -c \\"SELECT player_name, jsonb_array_length(recent_games) as games_count FROM players WHERE recent_games IS NOT NULL LIMIT 5;\\""'
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode('utf-8', errors='replace'))

        print("=== Checking PM2 Logs ===")
        stdin, stdout, stderr = client.exec_command("pm2 logs hoopstats --lines 50 --nostream")
        print(stdout.read().decode())
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
