"""
Fetch Historical On/Off Splits Data
Populates the database with historical teammate performance data when star players sit out.
"""
import sys
import os
import json
import time
import requests

# Add the nba-prop-model path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'server', 'nba-prop-model', 'src', 'data'))

from on_off_calculator import OnOffSplitsCalculator

# Star players who have historically missed games - good candidates for on/off splits
STAR_PLAYERS = [
    # Eastern Conference
    {"id": 203507, "name": "Giannis Antetokounmpo", "team": "MIL"},
    {"id": 201142, "name": "Kevin Durant", "team": "PHX"},
    {"id": 201566, "name": "Joel Embiid", "team": "PHI"},
    {"id": 1628369, "name": "Jayson Tatum", "team": "BOS"},
    {"id": 203954, "name": "Jaylen Brown", "team": "BOS"},
    {"id": 203081, "name": "Damian Lillard", "team": "MIL"},
    {"id": 1629029, "name": "Trae Young", "team": "ATL"},
    {"id": 202681, "name": "Kyrie Irving", "team": "DAL"},
    {"id": 1628983, "name": "Cade Cunningham", "team": "DET"},
    {"id": 1630169, "name": "Tyrese Haliburton", "team": "IND"},
    {"id": 1628389, "name": "Bam Adebayo", "team": "MIA"},
    {"id": 1628978, "name": "Scottie Barnes", "team": "TOR"},
    
    # Western Conference  
    {"id": 203999, "name": "Nikola Jokic", "team": "DEN"},
    {"id": 1629027, "name": "Ja Morant", "team": "MEM"},
    {"id": 201935, "name": "James Harden", "team": "LAC"},
    {"id": 201142, "name": "Kevin Durant", "team": "PHX"},
    {"id": 203944, "name": "Julius Randle", "team": "MIN"},
    {"id": 1630162, "name": "Anthony Edwards", "team": "MIN"},
    {"id": 1628378, "name": "Donovan Mitchell", "team": "CLE"},
    {"id": 201142, "name": "LeBron James", "team": "LAL"},
    {"id": 203076, "name": "Anthony Davis", "team": "LAL"},
    {"id": 201939, "name": "Stephen Curry", "team": "GSW"},
    {"id": 1628381, "name": "Shai Gilgeous-Alexander", "team": "OKC"},
    {"id": 1629630, "name": "Ja Morant", "team": "MEM"},
    {"id": 1628973, "name": "Jalen Brunson", "team": "NYK"},
    {"id": 1630532, "name": "Chet Holmgren", "team": "OKC"},
    {"id": 1631094, "name": "Victor Wembanyama", "team": "SAS"},
    {"id": 203952, "name": "Kawhi Leonard", "team": "LAC"},
    {"id": 203110, "name": "Draymond Green", "team": "GSW"},
    {"id": 1628991, "name": "Paolo Banchero", "team": "ORL"},
]

# Remove duplicates based on player ID
STAR_PLAYERS = list({p['id']: p for p in STAR_PLAYERS}.values())

# Server API endpoint
API_BASE = "http://localhost:5000"

def trigger_calculation_via_api(player_id: int, player_name: str, team: str, seasons: list):
    """Trigger on/off splits calculation via the API endpoint"""
    try:
        response = requests.post(
            f"{API_BASE}/api/splits/calculate/{player_id}",
            json={
                "playerName": player_name,
                "team": team,
                "seasons": seasons
            },
            timeout=120
        )
        return response.status_code == 200
    except Exception as e:
        print(f"  API error: {e}")
        return False

def calculate_directly(player_id: int, player_name: str, team: str, seasons: list):
    """Calculate directly using Python calculator"""
    try:
        calculator = OnOffSplitsCalculator(request_delay=0.8)
        result = calculator.calculate_splits(
            star_player_id=str(player_id),
            team_abbr=team,
            seasons=seasons
        )
        return result
    except Exception as e:
        print(f"  Calculation error: {e}")
        return None

def main():
    print("=" * 60)
    print("Historical On/Off Splits Fetcher")
    print("=" * 60)
    print(f"\nThis will fetch splits data for {len(STAR_PLAYERS)} star players")
    print("Seasons: 2025-26 (current) and 2024-25 (last year)")
    print("\nNote: This uses the NBA Stats API and may take 30-60 minutes")
    print("      due to rate limiting requirements.\n")
    
    seasons = ["2025-26", "2024-25"]
    
    # Check if server is running
    print("Checking if server is running...")
    try:
        response = requests.get(f"{API_BASE}/api/teams", timeout=5)
        use_api = response.status_code == 200
        print(f"  Server status: {'Running' if use_api else 'Not available'}")
    except:
        use_api = False
        print("  Server not running - will calculate directly")
    
    print("\n" + "-" * 60)
    
    successful = 0
    failed = 0
    skipped = 0
    
    for i, player in enumerate(STAR_PLAYERS):
        player_id = player["id"]
        player_name = player["name"]
        team = player["team"]
        
        print(f"\n[{i+1}/{len(STAR_PLAYERS)}] {player_name} ({team})")
        
        if use_api:
            # Use API to trigger calculation (stores in DB automatically)
            success = trigger_calculation_via_api(player_id, player_name, team, seasons)
            if success:
                print(f"  [OK] Calculation triggered via API")
                successful += 1
            else:
                print(f"  [FAIL] API call failed")
                failed += 1
        else:
            # Calculate directly and print results
            result = calculate_directly(player_id, player_name, team, seasons)
            if result and 'teammates' in result:
                print(f"  [OK] Found data for {len(result['teammates'])} teammates")
                successful += 1
                # Save to file since no server
                output_file = f"splits_{player_id}_{team}.json"
                with open(output_file, 'w') as f:
                    json.dump(result, f, indent=2)
                print(f"  -> Saved to {output_file}")
            elif result and result.get('error'):
                print(f"  [SKIP] {result.get('error', 'No data')}")
                skipped += 1
            else:
                print(f"  [FAIL] No data found")
                failed += 1
        
        # Rate limiting - be respectful to NBA API
        if i < len(STAR_PLAYERS) - 1:
            print("  Waiting 3 seconds before next player...")
            time.sleep(3)
    
    print("\n" + "=" * 60)
    print("Summary:")
    print(f"  Successful: {successful}")
    print(f"  Failed: {failed}")
    print(f"  Skipped: {skipped}")
    print("=" * 60)

if __name__ == "__main__":
    main()
