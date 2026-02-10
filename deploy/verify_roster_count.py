import paramiko
import json

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Test the API
        print("=== Checking Team Formats ===")
        
        # Get Players
        stdin, stdout, stderr = client.exec_command("curl -s http://localhost:5000/api/ref-signal/players")
        players_json = stdout.read().decode('utf-8', errors='replace')
        try:
            p_data = json.loads(players_json)
            teams = [p['team'] for p in p_data.get('players', []) if 'team' in p]
            unique_teams = sorted(list(set(teams)))
            unk_count = teams.count('UNK')
            print(f"Unique Teams ({len(unique_teams)}): {unique_teams}")
            print(f"Players with UNK team: {unk_count}/{len(teams)}")
            
            # Print sample UNK player
            unk_players = [p['name'] for p in p_data.get('players', []) if p['team'] == 'UNK']
            if unk_players:
                print(f"Sample UNK players: {unk_players[:5]}")
        except:
            print("Failed to parse players")

        # Get Games
        stdin, stdout, stderr = client.exec_command("curl -s http://localhost:5000/api/ref-signal/games")
        games_json = stdout.read().decode('utf-8', errors='replace')
        try:
            g_data = json.loads(games_json)
            games = g_data.get('games', [])
            print(f"Games Found: {len(games)}")
            if games:
                print(f"Sample Game: Home='{games[0].get('homeTeam')}', Away='{games[0].get('awayTeam')}'")
        except:
            print("Failed to parse games")
            
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
