#!/usr/bin/env python3
import os, sys, traceback, json, logging
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
os.environ['DATABASE_URL'] = 'postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge'
logging.basicConfig(level=logging.DEBUG, format='%(name)s %(levelname)s %(message)s')

import psycopg2
from src.signals import registry, SUPPORTED_STAT_TYPES
from src.models.signal_projection_engine import SignalProjectionEngine, build_context_from_player_data
from src.data.context_enrichment import enrich_context

conn = psycopg2.connect(os.environ['DATABASE_URL'])
cursor = conn.cursor()

# Get one player line
cursor.execute("""
    SELECT pdl.prizepicks_player_id, pdl.player_name, pdl.team, pdl.stat_type, 
           pdl.opening_line, pdl.opponent, pdl.game_date,
           p.season_averages, p.last_5_averages, p.last_10_averages,
           p.home_averages, p.away_averages, p.position, p.recent_games
    FROM prizepicks_daily_lines pdl
    LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
    WHERE pdl.game_date = '2026-03-25' AND pdl.stat_type = 'Points'
    AND p.player_name IS NOT NULL
    LIMIT 1
""")
row = cursor.fetchone()
columns = [desc[0] for desc in cursor.description]
data = dict(zip(columns, row))

print(f"\n=== Testing: {data['player_name']} - {data['stat_type']} ===")
print(f"Team: {data['team']}, Opponent: {data['opponent']}, Date: {data['game_date']}")
print(f"Position: {data.get('position', 'N/A')}")

# Build context
context = build_context_from_player_data(data)
context['opponent'] = data.get('opponent', '')
context['game_date'] = data.get('game_date', '')
context['stat_type'] = data.get('stat_type', '')

print(f"\nContext BEFORE enrichment (keys): {list(context.keys())}")

# Enrich
enrich_context(conn, context, data)
print(f"\nContext AFTER enrichment (keys): {list(context.keys())}")
print(f"  is_home: {context.get('is_home')}")
print(f"  is_b2b: {context.get('is_b2b')}")
print(f"  opponent_pace: {context.get('opponent_pace')}")
print(f"  minutes_last_7: {context.get('minutes_last_7')}")
print(f"  opening_line: {context.get('opening_line')}")
print(f"  injured_teammates: {len(context.get('injured_teammates', []))} players")
print(f"  vs_team_history: {len(context.get('vs_team_history', []))} games")
print(f"  opp_positional_def: {bool(context.get('opp_positional_def'))}")

# Try running each signal individually
print("\n=== Running signals individually ===")
for signal_name, signal in registry._signals.items():
    try:
        if not signal.applies_to(data['stat_type']):
            print(f"  {signal_name}: SKIPPED (not applicable)")
            continue
        result = signal.calculate(
            player_id=data['prizepicks_player_id'],
            game_date=data['game_date'],
            stat_type=data['stat_type'],
            context=context,
        )
        status = "FIRED" if result.fired else "neutral"
        print(f"  {signal_name}: {status} (adj={result.adjustment:.3f}, dir={result.direction}, conf={result.confidence:.2f})")
    except Exception as e:
        print(f"  {signal_name}: ERROR - {e}")
        traceback.print_exc()

# Now try the full projection
print("\n=== Full projection ===")
try:
    engine = SignalProjectionEngine(conn)
    projection = engine.project(
        player_id=data['prizepicks_player_id'],
        player_name=data['player_name'],
        game_date=data['game_date'],
        stat_type=data['stat_type'],
        context=context,
        line=data.get('opening_line'),
    )
    print(f"  Baseline: {projection.baseline_value:.1f}")
    print(f"  Final: {projection.final_projection:.1f}")
    print(f"  Signals fired: {projection.signals_fired}")
    print(f"  Signal adjustments: {projection.signals}")
except Exception as e:
    print(f"  ERROR: {e}")
    traceback.print_exc()

cursor.close()
conn.close()
print("\n=== DEBUG DONE ===")
