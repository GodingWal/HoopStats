import psycopg2
import sys
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')

DB_URL = "host=localhost dbname=courtsideedge user=courtsideedge_user password=CourtSideEdge2026Secure!"
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# 1. List all tables and row counts
print("=" * 60)
print("DATABASE TABLES AND ROW COUNTS")
print("=" * 60)
cur.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")
tables = [r[0] for r in cur.fetchall()]
for t in tables:
    cur.execute(f"SELECT COUNT(*) FROM {t};")
    cnt = cur.fetchone()[0]
    print(f"  {t}: {cnt} rows")

# 2. Check key tables needed by signals
print("\n" + "=" * 60)
print("SIGNAL DATA REQUIREMENTS CHECK")
print("=" * 60)

# Check games table
cur.execute("SELECT COUNT(*) FROM games;")
print(f"\ngames: {cur.fetchone()[0]} rows")
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='games' ORDER BY ordinal_position;")
print(f"  columns: {[r[0] for r in cur.fetchall()]}")

# Check player_game_stats
cur.execute("SELECT COUNT(*) FROM player_game_stats;")
print(f"\nplayer_game_stats: {cur.fetchone()[0]} rows")
cur.execute("SELECT column_name FROM information_schema.columns WHERE table_name='player_game_stats' ORDER BY ordinal_position;")
print(f"  columns: {[r[0] for r in cur.fetchall()]}")

# Check if team_pace or similar exists
for t in ['team_pace', 'team_stats', 'defense_vs_position', 'matchup_history', 'referee_stats']:
    if t in tables:
        cur.execute(f"SELECT COUNT(*) FROM {t};")
        print(f"\n{t}: {cur.fetchone()[0]} rows")
    else:
        print(f"\n{t}: TABLE DOES NOT EXIST")

# 3. Try loading each signal module
print("\n" + "=" * 60)
print("SIGNAL MODULE LOADING TEST")
print("=" * 60)
signal_modules = [
    ("src.signals.positional_defense", "PositionalDefenseSignal"),
    ("src.signals.rest_days", "RestDaysSignal"),
    ("src.signals.back_to_back", "BackToBackSignal"),
    ("src.signals.pace_matchup", "PaceMatchupSignal"),
    ("src.signals.injury_alpha", "InjuryAlphaSignal"),
    ("src.signals.referee", "RefereeSignal"),
    ("src.signals.fatigue", "FatigueSignal"),
    ("src.signals.recent_form", "RecentFormSignal"),
    ("src.signals.home_away", "HomeAwaySignal"),
    ("src.signals.matchup_history", "MatchupHistorySignal"),
    ("src.signals.line_movement", "LineMovementSignal"),
    ("src.signals.blowout_risk", "BlowoutRiskSignal"),
]
for mod_path, cls_name in signal_modules:
    try:
        import importlib
        mod = importlib.import_module(mod_path)
        cls = getattr(mod, cls_name)
        sig = cls()
        print(f"  OK: {cls_name}")
    except Exception as e:
        print(f"  FAIL: {cls_name} - {e}")

# 4. Try running each signal with test data
print("\n" + "=" * 60)
print("SIGNAL EXECUTION TEST")
print("=" * 60)

# Get a real player_id and game from the DB
cur.execute("SELECT DISTINCT player_id FROM player_game_stats LIMIT 1;")
row = cur.fetchone()
test_player = row[0] if row else "unknown"

cur.execute("SELECT DISTINCT game_date FROM player_game_stats ORDER BY game_date DESC LIMIT 1;")
row = cur.fetchone()
test_date = str(row[0]) if row else "2025-11-15"

# Get team info
cur.execute(f"SELECT team_id FROM player_game_stats WHERE player_id='{test_player}' LIMIT 1;")
row = cur.fetchone()
test_team = row[0] if row else "unknown"

print(f"Test player: {test_player}, date: {test_date}, team: {test_team}")

for mod_path, cls_name in signal_modules:
    try:
        import importlib
        mod = importlib.import_module(mod_path)
        cls = getattr(mod, cls_name)
        sig = cls()
        result = sig.calculate(
            player_id=test_player,
            game_date=test_date,
            stat_type="Points",
            context={
                "player_id": test_player,
                "team_id": test_team,
                "opp_team_id": "BOS",
                "game_date": test_date,
                "prop_type": "Points",
                "prizepicks_line": 28.5,
                "position": "PG",
                "rest_days": 1,
                "opp_rest_days": 1,
                "season_averages": {"pts": 30.2, "reb": 5.1, "ast": 6.3},
                "last_5_averages": {"pts": 31.0, "reb": 5.3, "ast": 6.0},
                "home_game": True,
                "absent_players": [],
                "referee_crew": ["Scott Foster", "Tony Brothers"],
                "db_conn": conn,
            }
        )
        fired = result.fired if hasattr(result, 'fired') else "?"
        print(f"  {cls_name}: fired={fired}, adj={getattr(result, 'adjustment', '?')}")
    except Exception as e:
        print(f"  {cls_name}: ERROR - {e}")

conn.close()
