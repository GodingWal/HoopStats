#!/usr/bin/env python3
"""Fix: populate player positions matching by name."""
import os, sys, time, unicodedata
import psycopg2
import sys
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL


from nba_api.stats.endpoints import playerindex

def normalize(name):
    """Normalize name for matching."""
    if not name:
        return ""
    name = ''.join(c for c in unicodedata.normalize('NFD', name)
                   if unicodedata.category(c) != 'Mn')
    return name.lower().strip()

# Get all DB players
conn = psycopg2.connect(DATABASE_URL)
cur = conn.cursor()
cur.execute("SELECT id, player_name FROM players WHERE position IS NULL OR position = ''")
db_players = cur.fetchall()
print(f"DB players missing positions: {len(db_players)}")

# Build lookup by normalized name
db_lookup = {}
for pid, pname in db_players:
    db_lookup[normalize(pname)] = pid

# Get NBA API positions
pi = playerindex.PlayerIndex(season='2025-26')
time.sleep(1.5)
df = pi.get_data_frames()[0]
print(f"NBA API players: {len(df)}")

# Match by name
updated = 0
not_matched = []
for _, row in df.iterrows():
    first = str(row.get('PLAYER_FIRST_NAME', '')).strip()
    last = str(row.get('PLAYER_LAST_NAME', '')).strip()
    full_name = f"{first} {last}"
    pos = str(row.get('POSITION', '')).strip().upper()
    if not pos:
        continue

    norm = normalize(full_name)
    if norm in db_lookup:
        db_id = db_lookup[norm]
        cur.execute("UPDATE players SET position = %s WHERE id = %s", (pos, db_id))
        if cur.rowcount > 0:
            updated += 1
    else:
        not_matched.append(full_name)

conn.commit()

# Check result
cur.execute("SELECT COUNT(*) FROM players WHERE position IS NULL OR position = ''")
missing = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM players")
total = cur.fetchone()[0]
cur.execute("SELECT position, COUNT(*) cnt FROM players GROUP BY position ORDER BY cnt DESC")
dist = cur.fetchall()

cur.close()
conn.close()

print(f"\nUpdated: {updated}")
print(f"Still missing: {missing}/{total}")
print(f"Not matched from API: {len(not_matched)}")
if not_matched[:10]:
    print(f"  Sample unmatched: {not_matched[:10]}")
print("\nPosition distribution:")
for pos, cnt in dist:
    print(f"  {pos or '(empty)'}: {cnt}")
