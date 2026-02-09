"""
CourtSide Edge - Referee Foul Signal Module
============================================
Scrapes referee assignment data, calculates foul tendencies,
and generates player foul prop signals for PrizePicks.

Integration: Import into your existing nba_data_harvester.py
or run standalone as a daily cron job.
"""

import requests
import json
import os
from datetime import datetime, timedelta
from typing import Optional
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ref_foul_signal")

# ─── REFEREE FOUL TENDENCY DATABASE ───────────────────────────────
# Source: Basketball-Reference, RefMetrics, The F5 Substack
# Updated: 2024-25 season data
# fouls_per_game = total PF in games they officiate (both teams combined)

REFEREE_DB = {
    "Tony Brothers":     {"fouls_pg": 42.3, "fta_pg": 48.1, "techs": 15, "over_rate": 0.58, "diff_vs_avg": 4.5,  "tier": "HIGH",     "exp_yrs": 30},
    "Scott Foster":      {"fouls_pg": 41.8, "fta_pg": 47.5, "techs": 12, "over_rate": 0.55, "diff_vs_avg": 4.0,  "tier": "HIGH",     "exp_yrs": 30},
    "Kane Fitzgerald":   {"fouls_pg": 41.2, "fta_pg": 46.8, "techs": 10, "over_rate": 0.54, "diff_vs_avg": 3.4,  "tier": "HIGH",     "exp_yrs": 15},
    "James Williams":    {"fouls_pg": 40.8, "fta_pg": 46.5, "techs": 18, "over_rate": 0.55, "diff_vs_avg": 3.0,  "tier": "HIGH",     "exp_yrs": 8},
    "Ed Malloy":         {"fouls_pg": 40.5, "fta_pg": 45.9, "techs": 9,  "over_rate": 0.53, "diff_vs_avg": 2.7,  "tier": "HIGH",     "exp_yrs": 22},
    "Andy Nagy":         {"fouls_pg": 39.9, "fta_pg": 46.2, "techs": 8,  "over_rate": 0.56, "diff_vs_avg": 2.1,  "tier": "HIGH",     "exp_yrs": 4},
    "Curtis Blair":      {"fouls_pg": 40.1, "fta_pg": 45.3, "techs": 7,  "over_rate": 0.52, "diff_vs_avg": 2.3,  "tier": "HIGH",     "exp_yrs": 10},
    "Brent Barnaky":     {"fouls_pg": 39.8, "fta_pg": 44.8, "techs": 6,  "over_rate": 0.51, "diff_vs_avg": 2.0,  "tier": "MID-HIGH", "exp_yrs": 6},
    "Bill Kennedy":      {"fouls_pg": 39.5, "fta_pg": 44.5, "techs": 11, "over_rate": 0.51, "diff_vs_avg": 1.7,  "tier": "MID-HIGH", "exp_yrs": 28},
    "Sean Corbin":       {"fouls_pg": 39.2, "fta_pg": 44.2, "techs": 8,  "over_rate": 0.50, "diff_vs_avg": 1.4,  "tier": "MID-HIGH", "exp_yrs": 20},
    "Sha'Rae Mitchell":  {"fouls_pg": 38.8, "fta_pg": 43.6, "techs": 3,  "over_rate": 0.49, "diff_vs_avg": 1.0,  "tier": "MID",      "exp_yrs": 3},
    "Rodney Mott":       {"fouls_pg": 39.0, "fta_pg": 43.8, "techs": 7,  "over_rate": 0.49, "diff_vs_avg": 1.2,  "tier": "MID",      "exp_yrs": 18},
    "Simone Jelks":      {"fouls_pg": 38.2, "fta_pg": 43.0, "techs": 3,  "over_rate": 0.46, "diff_vs_avg": 0.4,  "tier": "MID",      "exp_yrs": 4},
    "Leon Wood":         {"fouls_pg": 38.7, "fta_pg": 43.5, "techs": 6,  "over_rate": 0.48, "diff_vs_avg": 0.9,  "tier": "MID",      "exp_yrs": 17},
    "Tre Maddox":        {"fouls_pg": 38.5, "fta_pg": 43.2, "techs": 5,  "over_rate": 0.47, "diff_vs_avg": 0.7,  "tier": "MID",      "exp_yrs": 7},
    "Marc Davis":        {"fouls_pg": 38.0, "fta_pg": 42.8, "techs": 9,  "over_rate": 0.46, "diff_vs_avg": 0.2,  "tier": "MID",      "exp_yrs": 25},
    "Zach Zarba":        {"fouls_pg": 37.8, "fta_pg": 42.5, "techs": 8,  "over_rate": 0.45, "diff_vs_avg": 0.0,  "tier": "MID",      "exp_yrs": 18},
    "Josh Tiven":        {"fouls_pg": 37.5, "fta_pg": 42.2, "techs": 7,  "over_rate": 0.44, "diff_vs_avg": -0.3, "tier": "MID",      "exp_yrs": 12},
    "Natalie Sago":      {"fouls_pg": 37.6, "fta_pg": 42.3, "techs": 4,  "over_rate": 0.44, "diff_vs_avg": -0.2, "tier": "MID",      "exp_yrs": 6},
    "Ben Taylor":        {"fouls_pg": 37.2, "fta_pg": 41.8, "techs": 5,  "over_rate": 0.43, "diff_vs_avg": -0.6, "tier": "MID-LOW",  "exp_yrs": 8},
    "JB DeRosa":         {"fouls_pg": 37.0, "fta_pg": 41.5, "techs": 6,  "over_rate": 0.42, "diff_vs_avg": -0.8, "tier": "MID-LOW",  "exp_yrs": 14},
    "Derrick Collins":   {"fouls_pg": 36.8, "fta_pg": 41.2, "techs": 4,  "over_rate": 0.41, "diff_vs_avg": -1.0, "tier": "MID-LOW",  "exp_yrs": 9},
    "Jacyn Goble":       {"fouls_pg": 37.0, "fta_pg": 41.5, "techs": 5,  "over_rate": 0.42, "diff_vs_avg": -0.8, "tier": "MID-LOW",  "exp_yrs": 7},
    "Eric Lewis":        {"fouls_pg": 36.5, "fta_pg": 40.8, "techs": 5,  "over_rate": 0.40, "diff_vs_avg": -1.3, "tier": "LOW",      "exp_yrs": 16},
    "Karl Lane":         {"fouls_pg": 36.2, "fta_pg": 40.5, "techs": 3,  "over_rate": 0.39, "diff_vs_avg": -1.6, "tier": "LOW",      "exp_yrs": 6},
    "Marat Kogut":       {"fouls_pg": 36.0, "fta_pg": 40.2, "techs": 4,  "over_rate": 0.38, "diff_vs_avg": -1.8, "tier": "LOW",      "exp_yrs": 10},
    "Matt Boland":       {"fouls_pg": 35.7, "fta_pg": 39.8, "techs": 3,  "over_rate": 0.37, "diff_vs_avg": -2.1, "tier": "LOW",      "exp_yrs": 5},
    "John Goble":        {"fouls_pg": 35.5, "fta_pg": 39.5, "techs": 5,  "over_rate": 0.36, "diff_vs_avg": -2.3, "tier": "LOW",      "exp_yrs": 17},
    "Tyler Ford":        {"fouls_pg": 35.2, "fta_pg": 39.2, "techs": 4,  "over_rate": 0.35, "diff_vs_avg": -2.6, "tier": "LOW",      "exp_yrs": 8},
    "Kevin Scott":       {"fouls_pg": 38.3, "fta_pg": 43.0, "techs": 4,  "over_rate": 0.46, "diff_vs_avg": 0.5,  "tier": "MID",      "exp_yrs": 5},
}

LEAGUE_AVG_FOULS_PG = 37.8  # 2024-25 league average total PF per game

# ─── PLAYER FOUL PRONENESS DATABASE ──────────────────────────────
# Source: NBA.com, Basketball-Reference
# pf_pg = personal fouls per game, pf_36 = per 36 min

PLAYER_FOUL_DB = {
    "Jaren Jackson Jr.":      {"team": "MEM", "pos": "PF", "pf_pg": 3.8, "pf_36": 4.3, "foul_tier": "VERY_HIGH", "std_dev": 1.1},
    "Chet Holmgren":          {"team": "OKC", "pos": "PF", "pf_pg": 3.6, "pf_36": 4.3, "foul_tier": "VERY_HIGH", "std_dev": 1.0},
    "Alperen Sengun":         {"team": "HOU", "pos": "C",  "pf_pg": 3.5, "pf_36": 3.9, "foul_tier": "VERY_HIGH", "std_dev": 1.0},
    "Walker Kessler":         {"team": "UTA", "pos": "C",  "pf_pg": 3.1, "pf_36": 4.6, "foul_tier": "VERY_HIGH", "std_dev": 1.1},
    "Daniel Gafford":         {"team": "DAL", "pos": "C",  "pf_pg": 2.8, "pf_36": 4.6, "foul_tier": "VERY_HIGH", "std_dev": 0.9},
    "Jalen Duren":            {"team": "DET", "pos": "C",  "pf_pg": 3.3, "pf_36": 4.2, "foul_tier": "VERY_HIGH", "std_dev": 1.0},
    "Giannis Antetokounmpo":  {"team": "MIL", "pos": "PF", "pf_pg": 3.5, "pf_36": 3.5, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Victor Wembanyama":      {"team": "SAS", "pos": "C",  "pf_pg": 3.4, "pf_36": 3.7, "foul_tier": "HIGH",      "std_dev": 1.0},
    "Nikola Jokic":           {"team": "DEN", "pos": "C",  "pf_pg": 3.3, "pf_36": 3.3, "foul_tier": "HIGH",      "std_dev": 0.8},
    "Rudy Gobert":            {"team": "MIN", "pos": "C",  "pf_pg": 3.3, "pf_36": 3.9, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Domantas Sabonis":       {"team": "SAC", "pos": "C",  "pf_pg": 3.2, "pf_36": 3.3, "foul_tier": "HIGH",      "std_dev": 0.8},
    "Karl-Anthony Towns":     {"team": "NYK", "pos": "C",  "pf_pg": 3.2, "pf_36": 3.3, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Brook Lopez":            {"team": "MIL", "pos": "C",  "pf_pg": 3.1, "pf_36": 3.9, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Joel Embiid":            {"team": "PHI", "pos": "C",  "pf_pg": 3.1, "pf_36": 3.3, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Bam Adebayo":            {"team": "MIA", "pos": "C",  "pf_pg": 3.0, "pf_36": 3.1, "foul_tier": "HIGH",      "std_dev": 0.8},
    "Ivica Zubac":            {"team": "LAC", "pos": "C",  "pf_pg": 3.0, "pf_36": 3.6, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Scottie Barnes":         {"team": "TOR", "pos": "PF", "pf_pg": 3.0, "pf_36": 3.1, "foul_tier": "HIGH",      "std_dev": 0.8},
    "Devin Booker":           {"team": "PHX", "pos": "SG", "pf_pg": 3.0, "pf_36": 3.1, "foul_tier": "MID_HIGH",  "std_dev": 0.8},
    "Isaiah Hartenstein":     {"team": "OKC", "pos": "C",  "pf_pg": 2.9, "pf_36": 3.8, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Nic Claxton":            {"team": "BKN", "pos": "C",  "pf_pg": 2.9, "pf_36": 3.6, "foul_tier": "HIGH",      "std_dev": 0.9},
    "Anthony Davis":          {"team": "LAL", "pos": "PF", "pf_pg": 2.8, "pf_36": 2.8, "foul_tier": "MID_HIGH",  "std_dev": 0.8},
    "Luka Doncic":            {"team": "LAL", "pos": "PG", "pf_pg": 2.8, "pf_36": 2.8, "foul_tier": "MID_HIGH",  "std_dev": 0.8},
    "Dereck Lively II":       {"team": "DAL", "pos": "C",  "pf_pg": 2.7, "pf_36": 3.8, "foul_tier": "HIGH",      "std_dev": 0.9},
    "De'Aaron Fox":           {"team": "SAC", "pos": "PG", "pf_pg": 2.7, "pf_36": 2.7, "foul_tier": "MID_HIGH",  "std_dev": 0.7},
    "Evan Mobley":            {"team": "CLE", "pos": "PF", "pf_pg": 2.7, "pf_36": 2.9, "foul_tier": "MID_HIGH",  "std_dev": 0.7},
    "Zion Williamson":        {"team": "NOP", "pos": "PF", "pf_pg": 2.6, "pf_36": 3.1, "foul_tier": "MID_HIGH",  "std_dev": 0.8},
    "Myles Turner":           {"team": "IND", "pos": "C",  "pf_pg": 2.6, "pf_36": 3.1, "foul_tier": "MID_HIGH",  "std_dev": 0.7},
    "Franz Wagner":           {"team": "ORL", "pos": "SF", "pf_pg": 2.5, "pf_36": 2.5, "foul_tier": "MID",       "std_dev": 0.7},
    "Anthony Edwards":        {"team": "MIN", "pos": "SG", "pf_pg": 2.5, "pf_36": 2.5, "foul_tier": "MID",       "std_dev": 0.7},
    "Donovan Mitchell":       {"team": "CLE", "pos": "SG", "pf_pg": 2.4, "pf_36": 2.5, "foul_tier": "MID",       "std_dev": 0.6},
    "Jalen Brunson":          {"team": "NYK", "pos": "PG", "pf_pg": 2.4, "pf_36": 2.5, "foul_tier": "MID",       "std_dev": 0.6},
    "Jayson Tatum":           {"team": "BOS", "pos": "SF", "pf_pg": 2.3, "pf_36": 2.3, "foul_tier": "MID",       "std_dev": 0.6},
    "Lauri Markkanen":        {"team": "UTA", "pos": "PF", "pf_pg": 2.2, "pf_36": 2.3, "foul_tier": "MID",       "std_dev": 0.6},
    "Shai Gilgeous-Alexander":{"team": "OKC", "pos": "PG", "pf_pg": 2.2, "pf_36": 2.3, "foul_tier": "MID",       "std_dev": 0.6},
    "Stephen Curry":          {"team": "GSW", "pos": "PG", "pf_pg": 2.0, "pf_36": 2.1, "foul_tier": "LOW_MID",   "std_dev": 0.5},
    "Jimmy Butler":           {"team": "MIA", "pos": "SF", "pf_pg": 1.9, "pf_36": 2.1, "foul_tier": "LOW_MID",   "std_dev": 0.5},
    "LeBron James":           {"team": "LAL", "pos": "SF", "pf_pg": 1.8, "pf_36": 1.9, "foul_tier": "LOW",       "std_dev": 0.5},
    "Trae Young":             {"team": "ATL", "pos": "PG", "pf_pg": 1.5, "pf_36": 1.5, "foul_tier": "VERY_LOW",  "std_dev": 0.4},
}

# ─── TIER MULTIPLIERS ─────────────────────────────────────────────
# How much foul-prone players' PF/G increases based on ref tier
TIER_UPLIFT = {
    "HIGH":     0.11,   # +11% fouls in games with HIGH-tier refs
    "MID-HIGH": 0.055,  # +5.5%
    "MID":      0.00,   # baseline
    "MID-LOW": -0.04,   # -4%
    "LOW":     -0.06,   # -6%
}


def get_ref_tier(ref_name: str) -> Optional[dict]:
    """Look up referee foul tendency data."""
    return REFEREE_DB.get(ref_name)


def get_crew_composite_tier(crew: list[str]) -> dict:
    """Calculate composite foul tendency for a 3-ref crew."""
    found = [REFEREE_DB[r] for r in crew if r in REFEREE_DB]
    if not found:
        return {"tier": "UNKNOWN", "avg_fouls_pg": LEAGUE_AVG_FOULS_PG, "uplift": 0.0}

    avg_fouls = sum(r["fouls_pg"] for r in found) / len(found)
    avg_diff = sum(r["diff_vs_avg"] for r in found) / len(found)

    if avg_diff >= 2.0:
        tier = "HIGH"
    elif avg_diff >= 1.0:
        tier = "MID-HIGH"
    elif avg_diff >= -0.5:
        tier = "MID"
    elif avg_diff >= -1.5:
        tier = "MID-LOW"
    else:
        tier = "LOW"

    uplift = TIER_UPLIFT.get(tier, 0.0)
    return {
        "tier": tier,
        "avg_fouls_pg": round(avg_fouls, 1),
        "diff_vs_avg": round(avg_diff, 1),
        "uplift": uplift,
        "refs_found": len(found),
        "refs_total": len(crew),
        "ref_details": [{
            "name": crew[i] if i < len(crew) else "Unknown",
            "fouls_pg": found[i]["fouls_pg"] if i < len(found) else None,
            "tier": found[i]["tier"] if i < len(found) else "UNKNOWN",
        } for i in range(len(found))],
    }


def calculate_player_foul_signal(
    player_name: str,
    ref_crew: list[str],
    prizepicks_line: Optional[float] = None,
    pace_factor: float = 1.0,     # 1.0 = avg pace, 1.05 = fast, 0.95 = slow
    b2b_flag: bool = False,        # back-to-back adds +0.2 PF
) -> Optional[dict]:
    """
    Core signal calculation.
    Returns projected fouls, signal strength, and action recommendation.
    """
    player = PLAYER_FOUL_DB.get(player_name)
    if not player:
        return None

    crew_data = get_crew_composite_tier(ref_crew)
    base_pf = player["pf_pg"]
    std_dev = player["std_dev"]

    # Apply ref uplift
    ref_adjusted_pf = base_pf * (1 + crew_data["uplift"])

    # Apply pace factor
    pace_adjusted_pf = ref_adjusted_pf * pace_factor

    # Apply B2B fatigue boost
    if b2b_flag:
        pace_adjusted_pf += 0.2

    projected_pf = round(pace_adjusted_pf, 2)

    # Calculate signal vs PrizePicks line
    if prizepicks_line:
        signal = round((projected_pf - prizepicks_line) / std_dev, 2)
    else:
        # Default line based on tier
        default_lines = {
            "VERY_HIGH": 3.5, "HIGH": 3.5, "MID_HIGH": 3.5,
            "MID": 2.5, "LOW_MID": 2.5, "LOW": 1.5, "VERY_LOW": 1.5,
        }
        prizepicks_line = default_lines.get(player["foul_tier"], 2.5)
        signal = round((projected_pf - prizepicks_line) / std_dev, 2)

    # Action recommendation
    if signal >= 1.5:
        action = "SMASH_OVER"
        confidence = "VERY_HIGH"
    elif signal >= 1.0:
        action = "STRONG_OVER"
        confidence = "HIGH"
    elif signal >= 0.5:
        action = "LEAN_OVER"
        confidence = "MID"
    elif signal <= -1.5:
        action = "SMASH_UNDER"
        confidence = "VERY_HIGH"
    elif signal <= -1.0:
        action = "STRONG_UNDER"
        confidence = "HIGH"
    elif signal <= -0.5:
        action = "LEAN_UNDER"
        confidence = "MID"
    else:
        action = "NO_PLAY"
        confidence = "NONE"

    return {
        "player": player_name,
        "team": player["team"],
        "position": player["pos"],
        "foul_tier": player["foul_tier"],
        "base_pf_pg": base_pf,
        "ref_crew_tier": crew_data["tier"],
        "ref_uplift_pct": round(crew_data["uplift"] * 100, 1),
        "pace_factor": pace_factor,
        "b2b": b2b_flag,
        "projected_pf": projected_pf,
        "prizepicks_line": prizepicks_line,
        "signal_strength": signal,
        "action": action,
        "confidence": confidence,
        "ref_details": crew_data.get("ref_details", []),
    }


def scan_all_players_for_game(
    ref_crew: list[str],
    team_abbrevs: list[str],
    pace_factor: float = 1.0,
    b2b_teams: list[str] = None,
) -> list[dict]:
    """
    Scan all tracked players on given teams and return sorted signals.
    Use this on game day after ref assignments drop.
    """
    if b2b_teams is None:
        b2b_teams = []

    signals = []
    for player_name, data in PLAYER_FOUL_DB.items():
        if data["team"] in team_abbrevs:
            is_b2b = data["team"] in b2b_teams
            result = calculate_player_foul_signal(
                player_name, ref_crew,
                pace_factor=pace_factor,
                b2b_flag=is_b2b,
            )
            if result and result["action"] != "NO_PLAY":
                signals.append(result)

    signals.sort(key=lambda x: abs(x["signal_strength"]), reverse=True)
    return signals


def fetch_todays_ref_assignments() -> list[dict]:
    """
    Fetch today's referee assignments from NBA.com.
    Assignments post at ~9:00 AM ET daily.
    Returns list of {game, refs} dicts.

    NOTE: NBA.com doesn't have a clean public API for this.
    Options:
    1. Scrape official.nba.com/referee-assignments/
    2. Use a 3rd party API (RefMetrics, NBAstuffer)
    3. Manual entry from the page

    This returns a stub - replace with your scraping logic.
    """
    logger.info("Fetching referee assignments...")
    # TODO: Implement scraper for official.nba.com/referee-assignments/
    # For now, return empty - you'll input manually or build a scraper
    return []


# ─── API ENDPOINT HANDLERS ────────────────────────────────────────
# These return JSON for your Express/FastAPI routes

def api_get_all_referees():
    """GET /api/ref-signal/referees"""
    refs = []
    for name, data in sorted(REFEREE_DB.items(), key=lambda x: x[1]["fouls_pg"], reverse=True):
        refs.append({"name": name, **data})
    return refs


def api_get_all_foul_prone_players():
    """GET /api/ref-signal/players"""
    players = []
    for name, data in sorted(PLAYER_FOUL_DB.items(), key=lambda x: x[1]["pf_pg"], reverse=True):
        players.append({"name": name, **data})
    return players


def api_calculate_signal(payload: dict):
    """
    POST /api/ref-signal/calculate
    Body: {
        "player": "Jaren Jackson Jr.",
        "refs": ["Tony Brothers", "Scott Foster", "Kane Fitzgerald"],
        "line": 4.5,
        "pace_factor": 1.0,
        "b2b": false
    }
    """
    return calculate_player_foul_signal(
        player_name=payload["player"],
        ref_crew=payload["refs"],
        prizepicks_line=payload.get("line"),
        pace_factor=payload.get("pace_factor", 1.0),
        b2b_flag=payload.get("b2b", False),
    )


def api_scan_game(payload: dict):
    """
    POST /api/ref-signal/scan-game
    Body: {
        "refs": ["Tony Brothers", "Ed Malloy", "Tre Maddox"],
        "teams": ["MEM", "MIL"],
        "pace_factor": 1.03,
        "b2b_teams": ["MEM"]
    }
    """
    return scan_all_players_for_game(
        ref_crew=payload["refs"],
        team_abbrevs=payload["teams"],
        pace_factor=payload.get("pace_factor", 1.0),
        b2b_teams=payload.get("b2b_teams", []),
    )


# ─── STANDALONE TEST ──────────────────────────────────────────────
if __name__ == "__main__":
    print("\n=== CourtSide Edge: Ref Foul Signal Test ===\n")

    # Simulate: MEM vs MIL with Tony Brothers crew
    crew = ["Tony Brothers", "Ed Malloy", "Tre Maddox"]
    teams = ["MEM", "MIL"]

    print(f"Ref Crew: {', '.join(crew)}")
    composite = get_crew_composite_tier(crew)
    print(f"Crew Tier: {composite['tier']} | Avg Fouls/G: {composite['avg_fouls_pg']} | Uplift: {composite['uplift']*100:.1f}%\n")

    signals = scan_all_players_for_game(crew, teams, pace_factor=1.02, b2b_teams=["MEM"])

    print(f"{'Player':<25} {'Base PF':>8} {'Proj PF':>8} {'Line':>6} {'Signal':>8} {'Action':<15}")
    print("-" * 75)
    for s in signals:
        print(f"{s['player']:<25} {s['base_pf_pg']:>8.1f} {s['projected_pf']:>8.2f} {s['prizepicks_line']:>6.1f} {s['signal_strength']:>8.2f} {s['action']:<15}")
