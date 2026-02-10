import sys
import os
import pandas as pd
sys.path.append('/var/www/hoopstats')
from server.nba-prop-model.src.data.nba_api_client import NBADataClient

def main():
    print("Initializing client...")
    client = NBADataClient()
    
    # Walker Kessler ID or Lebron
    # Lebron: 2544
    pid = 2544 
    print(f"Fetching game log for player {pid}...")
    try:
        df = client.get_player_game_log(pid, season="2025-26")
        print("Columns:", df.columns.tolist())
        if not df.empty:
            print("First row:", df.iloc[0].to_dict())
            if 'TEAM_ABBREVIATION' in df.columns:
                print("TEAM_ABBREVIATION found:", df.iloc[0]['TEAM_ABBREVIATION'])
            else:
                print("TEAM_ABBREVIATION NOT FOUND")
    except Exception as e:
        print(f"Error fetching game log: {e}")

    print("\nFetching player info...")
    try:
        info = client.get_player_info(pid)
        print("Player Info keys:", info.keys())
        print("Player Info:", info)
    except Exception as e:
        print(f"Error fetching player info: {e}")

if __name__ == "__main__":
    main()
