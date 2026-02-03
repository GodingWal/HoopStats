from nba_api.stats.endpoints import scoreboardv2, boxscoresummaryv2
import pandas as pd

# 1. Get recent games to find game IDs
print("Fetching recent games...")
board = scoreboardv2.ScoreboardV2(game_date='2024-02-01') # Use a past date with games
games = board.game_header.get_data_frame()
game_ids = games['GAME_ID'].head(3).tolist()

print(f"Checking Game IDs: {game_ids}")

# 2. Check BoxScoreSummaryV2 for referee info
for game_id in game_ids:
    print(f"\nChecking Game {game_id}...")
    try:
        summary = boxscoresummaryv2.BoxScoreSummaryV2(game_id=game_id)
        # Check officials
        officials = summary.officials.get_data_frame()
        if not officials.empty:
            print("Found Officials:")
            print(officials[['OFFICIAL_ID', 'FIRST_NAME', 'LAST_NAME', 'JERSEY_NUM']])
        else:
            print("No officials found in BoxScoreSummaryV2")
    except Exception as e:
        print(f"Error: {e}")
