#!/usr/bin/env python3
"""
Check player alerts against today's projections.
Run after projections are generated in the daily pipeline.
"""

import psycopg2
import os
from datetime import date

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge"
)

TIER_LEVELS = {"SMASH": 3, "STRONG": 2, "LEAN": 1}

def get_connection():
    return psycopg2.connect(DATABASE_URL)

def check_alerts():
    conn = get_connection()
    cur = conn.cursor()
    today = date.today()

    # Get all active alerts
    cur.execute("""
        SELECT id, player_id, player_name, stat_types, min_tier
        FROM player_alerts
        WHERE active = TRUE
    """)
    alerts = cur.fetchall()

    if not alerts:
        print("No active alerts found.")
        conn.close()
        return

    print(f"Checking {len(alerts)} active alerts for {today}...")
    triggered_count = 0

    for alert_id, player_id, player_name, stat_types, min_tier in alerts:
        min_tier_level = TIER_LEVELS.get(min_tier, 2)

        # Build query for matching projections
        query = """
            SELECT prop_type, confidence_tier, edge_pct, prizepicks_line, final_projection
            FROM projection_outputs
            WHERE player_id = %s AND game_date = %s
              AND confidence_tier IS NOT NULL
        """
        params = [player_id, today]

        if stat_types:
            query += " AND prop_type = ANY(%s)"
            params.append(stat_types)

        cur.execute(query, params)
        projections = cur.fetchall()

        for prop_type, tier, edge_pct, pp_line, projected in projections:
            tier_level = TIER_LEVELS.get(tier, 0)
            if tier_level < min_tier_level:
                continue

            # Check if already triggered today for this combo
            cur.execute("""
                SELECT COUNT(*) FROM triggered_alerts
                WHERE alert_id = %s AND player_id = %s AND stat_type = %s AND game_date = %s
            """, [alert_id, player_id, prop_type, today])
            if cur.fetchone()[0] > 0:
                continue

            # Create triggered alert
            cur.execute("""
                INSERT INTO triggered_alerts
                    (alert_id, player_id, player_name, stat_type, confidence_tier,
                     edge_pct, prizepicks_line, projected_value, game_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, [alert_id, player_id, player_name, prop_type, tier,
                  edge_pct, pp_line, projected, today])
            triggered_count += 1
            print(f"  ALERT: {player_name} {prop_type} - {tier} (edge: {edge_pct}%)")

    conn.commit()
    cur.close()
    conn.close()
    print(f"Done. {triggered_count} alerts triggered.")

if __name__ == "__main__":
    check_alerts()
