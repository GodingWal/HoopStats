#!/usr/bin/env python3
"""
CourtSideEdge Daily Email Summary
Sends a daily email with today's top picks, yesterday's results,
and overall accuracy stats.
"""

import os
import sys
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
import psycopg2
import psycopg2.extras

# Configuration
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgres://courtsideedge_user:CourtSideEdge2026Secure!@localhost:5432/courtsideedge"
)
TO_EMAIL = os.environ.get("TO_EMAIL", "gwal325@gmail.com")
FROM_EMAIL = "picks@courtsideedge.com"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("/var/log/courtsideedge/daily_email.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


def get_db_connection():
    return psycopg2.connect(DATABASE_URL)


def get_todays_picks(conn):
    """Get today's top picks from projection_outputs joined with prizepicks lines."""
    today = datetime.now().strftime("%Y-%m-%d")
    query = """
        SELECT
            COALESCE(pdl.player_name, 'Player #' || po.player_id) as player_name,
            po.prop_type,
            po.confidence_tier,
            po.edge_pct,
            po.final_projection,
            po.prizepicks_line,
            CASE WHEN po.final_projection > po.prizepicks_line THEN 'OVER' ELSE 'UNDER' END as direction
        FROM projection_outputs po
        LEFT JOIN prizepicks_daily_lines pdl
            ON po.player_id = pdl.prizepicks_player_id
            AND po.game_date = pdl.game_date
            AND po.prop_type = pdl.stat_type
        WHERE po.game_date = %s
            AND po.confidence_tier != 'SKIP'
        ORDER BY po.edge_pct DESC
        LIMIT 20
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(query, (today,))
        return cur.fetchall()


def get_yesterdays_results(conn):
    """Get yesterday's settled results."""
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    query = """
        SELECT
            pdl.player_name,
            po.prop_type,
            po.confidence_tier,
            po.edge_pct,
            po.final_projection,
            po.prizepicks_line,
            pdl.actual_value,
            CASE WHEN po.final_projection > po.prizepicks_line THEN 'OVER' ELSE 'UNDER' END as direction,
            CASE
                WHEN (po.final_projection > po.prizepicks_line AND pdl.actual_value > pdl.opening_line)
                  OR (po.final_projection < po.prizepicks_line AND pdl.actual_value < pdl.opening_line)
                THEN TRUE ELSE FALSE
            END as hit
        FROM projection_outputs po
        JOIN prizepicks_daily_lines pdl
            ON po.player_id = pdl.prizepicks_player_id
            AND po.game_date = pdl.game_date
            AND po.prop_type = pdl.stat_type
        WHERE po.game_date = %s
            AND pdl.actual_value IS NOT NULL
            AND po.confidence_tier != 'SKIP'
        ORDER BY po.edge_pct DESC
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(query, (yesterday,))
        return cur.fetchall()


def get_accuracy_stats(conn):
    """Get overall accuracy stats and current streak."""
    query = """
        WITH daily_stats AS (
            SELECT
                po.game_date,
                COUNT(*) as total,
                SUM(CASE
                    WHEN (po.final_projection > po.prizepicks_line AND pdl.actual_value > pdl.opening_line)
                      OR (po.final_projection < po.prizepicks_line AND pdl.actual_value < pdl.opening_line)
                    THEN 1 ELSE 0
                END) as wins
            FROM projection_outputs po
            JOIN prizepicks_daily_lines pdl
                ON po.player_id = pdl.prizepicks_player_id
                AND po.game_date = pdl.game_date
                AND po.prop_type = pdl.stat_type
            WHERE pdl.actual_value IS NOT NULL
                AND po.confidence_tier != 'SKIP'
            GROUP BY po.game_date
            ORDER BY po.game_date DESC
        )
        SELECT
            SUM(total) as total_picks,
            SUM(wins) as total_wins,
            CASE WHEN SUM(total) > 0
                THEN ROUND(100.0 * SUM(wins) / SUM(total), 1)
                ELSE 0
            END as overall_accuracy,
            COUNT(DISTINCT game_date) as days_tracked,
            MIN(game_date) as first_date,
            MAX(game_date) as last_date
        FROM daily_stats
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(query)
        overall = cur.fetchone()

    # Get streak (consecutive winning days)
    streak_query = """
        WITH daily_stats AS (
            SELECT
                po.game_date,
                CASE WHEN SUM(CASE
                    WHEN (po.final_projection > po.prizepicks_line AND pdl.actual_value > pdl.opening_line)
                      OR (po.final_projection < po.prizepicks_line AND pdl.actual_value < pdl.opening_line)
                    THEN 1 ELSE 0
                END)::float / NULLIF(COUNT(*), 0) > 0.5 THEN TRUE ELSE FALSE END as winning_day
            FROM projection_outputs po
            JOIN prizepicks_daily_lines pdl
                ON po.player_id = pdl.prizepicks_player_id
                AND po.game_date = pdl.game_date
                AND po.prop_type = pdl.stat_type
            WHERE pdl.actual_value IS NOT NULL
                AND po.confidence_tier != 'SKIP'
            GROUP BY po.game_date
            ORDER BY po.game_date DESC
        )
        SELECT game_date, winning_day FROM daily_stats ORDER BY game_date DESC
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(streak_query)
        days = cur.fetchall()

    streak = 0
    for day in days:
        if day["winning_day"]:
            streak += 1
        else:
            break

    # Get accuracy by confidence tier
    tier_query = """
        SELECT
            po.confidence_tier,
            COUNT(*) as total,
            SUM(CASE
                WHEN (po.final_projection > po.prizepicks_line AND pdl.actual_value > pdl.opening_line)
                  OR (po.final_projection < po.prizepicks_line AND pdl.actual_value < pdl.opening_line)
                THEN 1 ELSE 0
            END) as wins
        FROM projection_outputs po
        JOIN prizepicks_daily_lines pdl
            ON po.player_id = pdl.prizepicks_player_id
            AND po.game_date = pdl.game_date
            AND po.prop_type = pdl.stat_type
        WHERE pdl.actual_value IS NOT NULL
            AND po.confidence_tier != 'SKIP'
        GROUP BY po.confidence_tier
        ORDER BY po.confidence_tier
    """
    with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
        cur.execute(tier_query)
        tiers = cur.fetchall()

    return overall, streak, tiers


def build_html_email(picks, results, overall, streak, tiers):
    """Build a clean HTML email."""
    today = datetime.now().strftime("%A, %B %d, %Y")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%A, %B %d")

    total_picks = int(overall["total_picks"] or 0)
    total_wins = int(overall["total_wins"] or 0)
    accuracy = float(overall["overall_accuracy"] or 0)
    days_tracked = int(overall["days_tracked"] or 0)

    # Yesterday results summary
    y_wins = sum(1 for r in results if r["hit"])
    y_losses = len(results) - y_wins
    y_pct = round(100 * y_wins / max(len(results), 1), 1)

    html = f"""<!DOCTYPE html>
<html>
<head>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; color: #e0e0e0; }}
  .container {{ max-width: 640px; margin: 0 auto; padding: 20px; }}
  .header {{ background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 24px; border-radius: 12px; margin-bottom: 20px; text-align: center; }}
  .header h1 {{ margin: 0; color: #00d4ff; font-size: 28px; }}
  .header .date {{ color: #8892b0; font-size: 14px; margin-top: 8px; }}
  .card {{ background: #1a1a2e; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #2a2a4a; }}
  .card h2 {{ color: #00d4ff; margin: 0 0 16px 0; font-size: 18px; border-bottom: 1px solid #2a2a4a; padding-bottom: 8px; }}
  .stats-grid {{ display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }}
  .stat-box {{ flex: 1; min-width: 100px; background: #0d1117; border-radius: 8px; padding: 12px; text-align: center; }}
  .stat-box .value {{ font-size: 24px; font-weight: 700; color: #00d4ff; }}
  .stat-box .label {{ font-size: 12px; color: #8892b0; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 14px; }}
  th {{ text-align: left; color: #8892b0; padding: 8px; border-bottom: 1px solid #2a2a4a; font-weight: 600; }}
  td {{ padding: 8px; border-bottom: 1px solid #1a1a3e; }}
  .over {{ color: #4ade80; }}
  .under {{ color: #f87171; }}
  .win {{ color: #4ade80; font-weight: 700; }}
  .loss {{ color: #f87171; font-weight: 700; }}
  .tier-smash {{ background: #166534; color: #4ade80; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }}
  .tier-strong {{ background: #1e3a5f; color: #60a5fa; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }}
  .tier-lean {{ background: #3f3f00; color: #fbbf24; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; }}
  .footer {{ text-align: center; color: #4a5568; font-size: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #2a2a4a; }}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>CourtSideEdge</h1>
    <div class="date">{today}</div>
  </div>
"""

    # Overall Stats Banner
    html += f"""
  <div class="card">
    <h2>Performance Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-box">
        <div class="value">{accuracy}%</div>
        <div class="label">Overall Accuracy</div>
      </div>
      <div class="stat-box">
        <div class="value">{total_wins}/{total_picks}</div>
        <div class="label">Win/Total</div>
      </div>
      <div class="stat-box">
        <div class="value">{streak}</div>
        <div class="label">Day Streak</div>
      </div>
      <div class="stat-box">
        <div class="value">{days_tracked}</div>
        <div class="label">Days Tracked</div>
      </div>
    </div>
"""
    # Tier breakdown
    if tiers:
        html += "    <table><tr><th>Tier</th><th>Record</th><th>Accuracy</th></tr>"
        for t in tiers:
            tw = int(t["wins"])
            tt = int(t["total"])
            ta = round(100 * tw / max(tt, 1), 1)
            tier_cls = t["confidence_tier"].lower()
            html += f'<tr><td><span class="tier-{tier_cls}">{t["confidence_tier"]}</span></td><td>{tw}/{tt}</td><td>{ta}%</td></tr>'
        html += "</table>"
    html += "  </div>"

    return html


    # Yesterday's Results
    if results:
        html += f"""
  <div class="card">
    <h2>Yesterday's Results ({yesterday}) &mdash; {y_wins}W / {y_losses}L ({y_pct}%)</h2>
    <table>
      <tr><th>Player</th><th>Prop</th><th>Pick</th><th>Line</th><th>Actual</th><th>Result</th></tr>
"""
        for r in results[:25]:
            direction = r["direction"]
            dir_cls = "over" if direction == "OVER" else "under"
            result_cls = "win" if r["hit"] else "loss"
            result_txt = "W" if r["hit"] else "L"
            actual = round(float(r["actual_value"]), 1)
            line = round(float(r["prizepicks_line"]), 1)
            tier_cls = r["confidence_tier"].lower()
            html += f"""      <tr>
        <td>{r["player_name"]}</td>
        <td>{r["prop_type"]}</td>
        <td class="{dir_cls}">{direction}</td>
        <td>{line}</td>
        <td>{actual}</td>
        <td class="{result_cls}">{result_txt}</td>
      </tr>
"""
        html += "    </table>\n  </div>"
    else:
        html += """
  <div class="card">
    <h2>Yesterday's Results</h2>
    <p style="color: #8892b0;">No settled results from yesterday.</p>
  </div>"""

    # Today's Picks
    if picks:
        html += f"""
  <div class="card">
    <h2>Today's Top Picks ({len(picks)} picks)</h2>
    <table>
      <tr><th>Player</th><th>Prop</th><th>Pick</th><th>Line</th><th>Proj</th><th>Edge</th><th>Tier</th></tr>
"""
        for p in picks:
            direction = p["direction"]
            dir_cls = "over" if direction == "OVER" else "under"
            proj = round(float(p["final_projection"]), 1)
            line = round(float(p["prizepicks_line"]), 1)
            edge = round(float(p["edge_pct"]), 1)
            tier_cls = p["confidence_tier"].lower()
            html += f"""      <tr>
        <td>{p["player_name"]}</td>
        <td>{p["prop_type"]}</td>
        <td class="{dir_cls}">{direction}</td>
        <td>{line}</td>
        <td>{proj}</td>
        <td>{edge}%</td>
        <td><span class="tier-{tier_cls}">{p["confidence_tier"]}</span></td>
      </tr>
"""
        html += "    </table>\n  </div>"
    else:
        html += """
  <div class="card">
    <h2>Today's Picks</h2>
    <p style="color: #8892b0;">No picks generated yet. Check back after the daily pipeline runs.</p>
  </div>"""

    html += """
  <div class="footer">
    <p>CourtSideEdge &mdash; NBA Props Analytics</p>
    <p>This is an automated daily summary. Do not reply to this email.</p>
  </div>
</div>
</body>
</html>"""

    return html


def send_email(html_content, to_email, subject):
    """Send email via local postfix."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = FROM_EMAIL
    msg["To"] = to_email

    # Plain text fallback
    plain_text = "CourtSideEdge Daily Summary - View in HTML email client for full experience."
    msg.attach(MIMEText(plain_text, "plain"))
    msg.attach(MIMEText(html_content, "html"))

    try:
        with smtplib.SMTP("localhost", 25) as server:
            server.sendmail(FROM_EMAIL, [to_email], msg.as_string())
        logger.info(f"Email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False


def main():
    logger.info("Starting daily email summary generation...")

    try:
        conn = get_db_connection()
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        sys.exit(1)

    try:
        # Gather data
        picks = get_todays_picks(conn)
        results = get_yesterdays_results(conn)
        overall, streak, tiers = get_accuracy_stats(conn)

        logger.info(f"Today's picks: {len(picks)}")
        logger.info(f"Yesterday's results: {len(results)}")
        logger.info(f"Overall stats: {dict(overall) if overall else 'None'}")
        logger.info(f"Streak: {streak} days")

        # Build email
        today_str = datetime.now().strftime("%m/%d")
        subject = f"CourtSideEdge Daily Picks - {today_str}"
        if results:
            y_wins = sum(1 for r in results if r["hit"])
            y_total = len(results)
            y_pct = round(100 * y_wins / max(y_total, 1), 1)
            subject += f" | Yesterday: {y_wins}/{y_total} ({y_pct}%)"

        html = build_html_email(picks, results, overall, streak, tiers)

        # Also save a local HTML copy for debugging
        debug_path = "/var/log/courtsideedge/last_email.html"
        with open(debug_path, "w") as f:
            f.write(html)
        logger.info(f"Saved debug copy to {debug_path}")

        # Send
        success = send_email(html, TO_EMAIL, subject)
        if success:
            logger.info("Daily email sent successfully!")
        else:
            logger.error("Failed to send daily email")
            sys.exit(1)

    except Exception as e:
        logger.error(f"Error generating email: {e}", exc_info=True)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
