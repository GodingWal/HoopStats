"""
Projection Engine - Fixed column names, autocommit mode for resilience.
"""

import logging
import os
import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

from src.signals.signal_engine import SignalEngine, GameContext

logger = logging.getLogger(__name__)
from config.db_config import get_connection as _shared_get_connection, DATABASE_URL
PRIZEPICKS_PAYOUT = 0.85

def _normalize_averages(avgs):
    """Normalize season_averages keys to lowercase for signal compatibility."""
    if not avgs:
        return {}
    result = {}
    for k, v in avgs.items():
        result[k.lower()] = v
        result[k.upper()] = v  # Keep both for backward compat
    # Add composite keys
    if 'pts' in result and 'reb' in result and 'ast' in result:
        result['pra'] = float(result.get('pts', 0) or 0) + float(result.get('reb', 0) or 0) + float(result.get('ast', 0) or 0)
    if 'pts' in result and 'reb' in result:
        result['pr'] = float(result.get('pts', 0) or 0) + float(result.get('reb', 0) or 0)
    if 'pts' in result and 'ast' in result:
        result['pa'] = float(result.get('pts', 0) or 0) + float(result.get('ast', 0) or 0)
    if 'reb' in result and 'ast' in result:
        result['ra'] = float(result.get('reb', 0) or 0) + float(result.get('ast', 0) or 0)
    return result



def _get_db_connection(autocommit=False):
    try:
        conn = _shared_get_connection()
        if autocommit:
            conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"DB connection failed: {e}")
        return None

def _safe_query(conn, sql, params=None, fetch="all"):
    """Execute a query safely - rollback on error, return empty on failure."""
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        if fetch == "one":
            result = cur.fetchone()
        elif fetch == "all":
            result = cur.fetchall()
        else:
            result = None
        cur.close()
        return result
    except Exception as e:
        logger.debug(f"Query failed: {e}")
        try:
            conn.rollback()
        except:
            pass
        return [] if fetch == "all" else None


# --- Context enrichment (FIX #3) with correct column names ---

def _enrich_injury_data(conn, team_id: str, game_date: str) -> Dict[str, Any]:
    result = {"absent_players": [], "injury_boosts": {}, "out_players": []}
    if not conn or not team_id:
        return result

    # injury_report: team, status, player_name, player_id, updated_at
    rows = _safe_query(conn, """
        SELECT player_name, status, player_id
        FROM injury_report
        WHERE LOWER(team) = LOWER(%s)
          AND status IN ('Out', 'out', 'OUT', 'Doubtful')
          AND game_date >= %s::date - INTERVAL '2 days'
    """, (team_id, game_date))
    for row in (rows or []):
        result["absent_players"].append(str(row[2] or row[0]))
        result["out_players"].append(row[0])

    # Fallback: player_injuries (last_updated, not updated_at)
    if not result["absent_players"]:
        rows = _safe_query(conn, """
            SELECT player_name, status
            FROM player_injuries
            WHERE LOWER(team) = LOWER(%s)
              AND status IN ('Out', 'out', 'OUT', 'Doubtful')
              AND is_active = true
        """, (team_id,))
        for row in (rows or []):
            result["absent_players"].append(row[0])
            result["out_players"].append(row[0])

    # injury_impacts: beneficiary-level boost data
    if result["absent_players"]:
        rows = _safe_query(conn, """
            SELECT beneficiary_player_name, stat, adjusted_mean, baseline_mean
            FROM injury_impacts
            WHERE LOWER(injured_player_team) = LOWER(%s)
              AND game_date = %s
        """, (team_id, game_date))
        for row in (rows or []):
            pname = row[0]
            stat = row[1]
            boost = float(row[2] or 0) - float(row[3] or 0)
            if pname not in result["injury_boosts"]:
                result["injury_boosts"][pname] = {}
            result["injury_boosts"][pname][stat] = boost

    return result


def _enrich_referee_data(conn, game_date: str, home_team: str, away_team: str) -> Dict[str, Any]:
    """Query referee_assignments table for referee crew and stats."""
    result = {"referee_crew": [], "referee_names": [], "game_referees": []}
    if not conn:
        return result
    rows = _safe_query(conn, """
        SELECT referee_name, avg_fouls_per_game
        FROM referee_assignments
        WHERE game_date = %s
          AND ((UPPER(home_team) = UPPER(%s) AND UPPER(away_team) = UPPER(%s))
            OR (UPPER(home_team) = UPPER(%s) AND UPPER(away_team) = UPPER(%s)))
    """, (game_date, home_team, away_team, away_team, home_team))
    for row in (rows or []):
        ref_name = row[0]
        avg_fouls = float(row[1]) if row[1] else None
        result["referee_crew"].append(ref_name)
        result["referee_names"].append(ref_name)
        result["game_referees"].append({
            "name": ref_name,
            "avg_fouls_per_game": avg_fouls,
            "avg_fouls": avg_fouls,
        })
    return result


def _enrich_matchup_history(conn, player_name: str, opp_team_id: str, game_date: str) -> List[Dict]:
    """Get player's historical performance vs opponent from players.vs_team JSONB."""
    if not conn or not player_name or not opp_team_id:
        return []
    row = _safe_query(conn, """
        SELECT vs_team FROM players
        WHERE LOWER(player_name) = LOWER(%s)
        LIMIT 1
    """, (player_name,), fetch="one")
    if not row or not row[0]:
        return []
    vs_team = row[0] if isinstance(row[0], dict) else json.loads(row[0]) if row[0] else {}
    # NBA team abbreviation variants (PrizePicks uses 3-letter, vs_team may use 2-3 letter)
    TEAM_ALIASES = {
        "GSW": "GS", "GS": "GSW", "NOP": "NO", "NO": "NOP", "NYK": "NY", "NY": "NYK",
        "SAS": "SA", "SA": "SAS", "OKC": "OKC", "PHX": "PHX", "WAS": "WSH", "WSH": "WAS",
        "BKN": "BK", "BK": "BKN", "LAL": "LAL", "LAC": "LAC", "CHA": "CHA", "CHI": "CHI",
        "UTA": "UTAH", "UTAH": "UTA",
    }
    opp_key = opp_team_id.upper()
    team_data = vs_team.get(opp_key)
    if not team_data:
        alt_key = TEAM_ALIASES.get(opp_key, "")
        team_data = vs_team.get(alt_key)
    if not team_data:
        team_data = vs_team.get(opp_team_id) or vs_team.get(opp_team_id.lower())
    if not team_data:
        return []
    n_games = int(team_data.get("games", 1))
    if n_games < 1:
        return []
    # Build synthetic game entries from aggregate vs_team data
    # The matchup_history signal uses recency-weighted averaging,
    # so we create n_games entries with the per-game averages
    avg_pts = float(team_data.get("PTS", 0))
    avg_reb = float(team_data.get("REB", 0))
    avg_ast = float(team_data.get("AST", 0))
    avg_fg3m = float(team_data.get("FG3M", 0))
    avg_pra = float(team_data.get("PRA", 0))
    history = []
    for i in range(n_games):
        history.append({
            "game_date": game_date, "GAME_DATE": game_date,
            "pts": avg_pts, "PTS": avg_pts,
            "reb": avg_reb, "REB": avg_reb,
            "ast": avg_ast, "AST": avg_ast,
            "fg3m": avg_fg3m, "FG3M": avg_fg3m,
            "stl": 0, "STL": 0, "blk": 0, "BLK": 0,
            "tov": 0, "TOV": 0, "min": 30, "MIN": 30,
            "pra": avg_pra, "PRA": avg_pra,
        })
    return history


def _enrich_defender_data(conn, player_name: str, opp_team_id: str, position: str) -> Dict[str, Any]:
    """Get likely primary defender info from team_defense_by_position."""
    result = {"primary_defender": "", "defender_stats": {}}
    if not conn or not opp_team_id:
        return result
    # Map player position codes to team_defense_by_position position codes
    # The table uses: PG, SG, SF, PF, C
    pos_map = {"G": "PG", "F": "SF", "C": "C", "G-F": "SG", "F-G": "SG",
               "F-C": "PF", "C-F": "PF", "PG": "PG", "SG": "SG", "SF": "SF", "PF": "PF"}
    mapped_pos = pos_map.get(position, "")
    if mapped_pos:
        row = _safe_query(conn, """
            SELECT pts_allowed, fg_pct_allowed, reb_allowed, ast_allowed
            FROM team_defense_by_position
            WHERE UPPER(team_id) = UPPER(%s)
              AND UPPER(position) = UPPER(%s)
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1
        """, (opp_team_id, mapped_pos), fetch="one")
        if row:
            pts_allowed = float(row[0] or 0)
            # League avg pts allowed per position varies; use ~20 as baseline
            league_avg_pts = 20.0
            if pts_allowed > 0:
                factor = pts_allowed / league_avg_pts
                reb_allowed = float(row[2] or 0)
                ast_allowed = float(row[3] or 0)
                result["defender_stats"] = {
                    "pts": factor,
                    "reb": reb_allowed / 5.0 if reb_allowed > 0 else 1.0,
                    "ast": ast_allowed / 4.0 if ast_allowed > 0 else 1.0,
                    "fg3m": float(row[1] or 0.45) / 0.45 if row[1] else 1.0,
                }
    return result


def _enrich_b2b_and_rest(conn, team_id: str, game_date: str) -> Dict[str, Any]:
    # rest_days=None means "no game data found — signal must not fire with a default"
    result = {"is_b2b": False, "rest_days": None, "home_game": None}
    if not conn:
        return result

    # games table: game_date, home_team, visitor_team
    row = _safe_query(conn, """
        SELECT game_date FROM games
        WHERE (LOWER(home_team) = LOWER(%s) OR LOWER(visitor_team) = LOWER(%s))
          AND game_date < %s
        ORDER BY game_date DESC LIMIT 1
    """, (team_id, team_id, game_date), fetch="one")

    if row:
        last_game = row[0]
        if hasattr(last_game, 'isoformat'):
            target = datetime.strptime(game_date, "%Y-%m-%d").date() if isinstance(game_date, str) else game_date
            days_diff = (target - last_game).days
            result["rest_days"] = max(0, days_diff - 1)
            result["is_b2b"] = days_diff <= 1

    # Check home/away
    row = _safe_query(conn, """
        SELECT home_team FROM games
        WHERE game_date = %s
          AND (LOWER(home_team) = LOWER(%s) OR LOWER(visitor_team) = LOWER(%s))
        LIMIT 1
    """, (game_date, team_id, team_id), fetch="one")
    if row and row[0]:
        result["home_game"] = row[0].upper() == team_id.upper()

    return result


def _enrich_recent_stats(conn, player_name: str, game_date: str) -> Dict[str, Any]:
    result = {"last_5_averages": {}, "last_10_averages": {}}
    if not conn:
        return result

    # player_game_stats: player_id (int), game_date, pts, reb, ast, fg3m, stl, blk, tov, minutes_played
    # Need to join with players table to get by name
    rows = _safe_query(conn, """
        SELECT pgs.pts, pgs.reb, pgs.ast, pgs.fg3m, pgs.stl, pgs.blk, pgs.tov, pgs.minutes_played
        FROM player_game_stats pgs
        JOIN players p ON pgs.player_id = p.player_id::text
        WHERE LOWER(p.player_name) = LOWER(%s)
          AND pgs.game_date < %s
        ORDER BY pgs.game_date DESC LIMIT 10
    """, (player_name, game_date))

    if not rows:
        return result

    def avg_stats(games):
        if not games:
            return {}
        n = len(games)
        return {
            "pts": round(sum(float(g[0] or 0) for g in games) / n, 1),
            "reb": round(sum(float(g[1] or 0) for g in games) / n, 1),
            "ast": round(sum(float(g[2] or 0) for g in games) / n, 1),
            "fg3m": round(sum(float(g[3] or 0) for g in games) / n, 1),
            "stl": round(sum(float(g[4] or 0) for g in games) / n, 1),
            "blk": round(sum(float(g[5] or 0) for g in games) / n, 1),
            "tov": round(sum(float(g[6] or 0) for g in games) / n, 1),
            "min": round(sum(float(g[7] or 0) for g in games) / n, 1),
        }

    result["last_5_averages"] = avg_stats(rows[:5])
    result["last_10_averages"] = avg_stats(rows[:10])
    return result


def _enrich_game_context_data(conn, game_date: str, team_id: str) -> Dict[str, Any]:
    result = {}
    if not conn:
        return result
    row = _safe_query(conn, """
        SELECT projected_total, spread, is_b2b_home, is_b2b_away, home_team_id, away_team_id
        FROM game_context
        WHERE game_date = %s
          AND (LOWER(home_team_id) = LOWER(%s) OR LOWER(away_team_id) = LOWER(%s))
        LIMIT 1
    """, (game_date, team_id, team_id), fetch="one")
    if row:
        result["projected_total"] = float(row[0]) if row[0] else None
        result["spread"] = float(row[1]) if row[1] else None
        if row[4] and row[4].upper() == team_id.upper():
            result["is_b2b"] = row[2] if row[2] else False
        else:
            result["is_b2b"] = row[3] if row[3] else False
    return result


# --- Signal results (FIX #7) ---

def _save_signal_results(conn, player_id, game_date, prop_type,
                         prizepicks_line, final_projection, edge_pct,
                         signals_fired, direction):
    try:
        cur = conn.cursor()
        for sig in signals_fired:
            cur.execute("""
                INSERT INTO signal_results
                    (signal_type, signal_strength, player_id, game_date, prop_type,
                     model_projection, prizepicks_line, edge_pct, direction, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            """, (
                sig.get("signal_name", "unknown"),
                "strong" if abs(sig.get("adjustment", 0)) > 0.5 else "moderate",
                str(player_id)[:20],
                game_date,
                prop_type[:30],
                round(final_projection, 2),
                round(prizepicks_line, 2),
                round(edge_pct, 2),
                sig.get("direction", direction),
            ))
        cur.close()
    except Exception as e:
        logger.debug(f"Save signal results failed: {e}")
        try:
            conn.rollback()
        except:
            pass


# --- Baseline ---

def _compute_baseline(conn, player_id: str, prop_type: str) -> Optional[float]:
    stat_col_map = {
        "Points": "PTS", "Rebounds": "REB", "Assists": "AST",
        "3-Pointers Made": "FG3M", "Steals": "STL",
        "Blocks": "BLK", "Blocked Shots": "BLK", "Turnovers": "TOV",
    }
    combo_map = {
        "Pts+Rebs": ["PTS", "REB"], "Pts+Asts": ["PTS", "AST"],
        "Rebs+Asts": ["REB", "AST"], "Pts+Rebs+Asts": ["PTS", "REB", "AST"],
        "Blks+Stls": ["BLK", "STL"],
    }
    if conn is None:
        return None

    row = _safe_query(conn,
        "SELECT season_averages FROM players WHERE LOWER(player_name) = LOWER(%s) LIMIT 1",
        (player_id,), fetch="one")
    if not row or not row[0]:
        return None
    avgs = row[0] if isinstance(row[0], dict) else json.loads(row[0])

    if prop_type in combo_map:
        return sum(float(avgs.get(c, 0)) for c in combo_map[prop_type])

    stat_key = stat_col_map.get(prop_type)
    if stat_key:
        val = avgs.get(stat_key)
        return float(val) if val is not None else None
    return None


def _baseline_from_averages(prop_type, season_averages):
    if not season_averages:
        return None
    avgs = {k.upper(): v for k, v in season_averages.items()}
    stat_col_map = {
        "Points": "PTS", "Rebounds": "REB", "Assists": "AST",
        "3-Pointers Made": "FG3M", "Steals": "STL",
        "Blocks": "BLK", "Turnovers": "TOV",
    }
    combo_map = {
        "Pts+Rebs": ["PTS", "REB"], "Pts+Asts": ["PTS", "AST"],
        "Rebs+Asts": ["REB", "AST"], "Pts+Rebs+Asts": ["PTS", "REB", "AST"],
        "Blks+Stls": ["BLK", "STL"],
    }
    if prop_type in combo_map:
        total = sum(float(avgs.get(c, 0) or 0) for c in combo_map[prop_type])
        return total if total > 0 else None
    key = stat_col_map.get(prop_type)
    if key:
        val = avgs.get(key)
        return float(val) if val else None
    return None


def _confidence_tier(aligned, edge_pct, conflict):
    if conflict: return "SKIP"
    if aligned >= 3 and edge_pct > 8.0: return "SMASH"
    if aligned >= 2 and 5.0 <= edge_pct <= 8.0: return "STRONG"
    if aligned >= 1 and 3.0 <= edge_pct < 5.0: return "LEAN"
    return "SKIP"


def _kelly_stake(edge_pct, payout=PRIZEPICKS_PAYOUT):
    p = max(0.01, min(0.99, 0.5 + edge_pct / 200))
    q = 1 - p
    f = (payout * p - q) / payout
    return round(max(0.0, f / 4), 4)


def project_player(player_id, game_date, prop_type, prizepicks_line,
                    game_context_extra, signal_engine, conn):
    baseline = _compute_baseline(conn, player_id, prop_type)
    if not baseline:
        baseline = _baseline_from_averages(prop_type, game_context_extra.get("season_averages") or {})
    if not baseline:
        return None

    team_id = game_context_extra.get("team_id", "")
    opp_team_id = game_context_extra.get("opp_team_id", "")

    ctx = GameContext(
        player_id=player_id, team_id=team_id, opp_team_id=opp_team_id,
        game_date=game_date, prop_type=prop_type, prizepicks_line=prizepicks_line,
        absent_players=game_context_extra.get("absent_players", []),
        referee_crew=game_context_extra.get("referee_crew", []),
        extra=game_context_extra,
    )

    engine_result = signal_engine.run(ctx)
    signal_delta = engine_result.weighted_delta
    final = round(baseline + signal_delta, 2)
    edge_pct = round((final - prizepicks_line) / prizepicks_line * 100, 2) if prizepicks_line else 0.0

    over_c = sum(1 for s in engine_result.signals_fired if s["direction"] == "OVER")
    under_c = sum(1 for s in engine_result.signals_fired if s["direction"] == "UNDER")
    aligned = max(over_c, under_c)
    tier = _confidence_tier(aligned, abs(edge_pct), engine_result.conflict_detected)
    kelly = _kelly_stake(abs(edge_pct)) if tier != "SKIP" else 0.0

    # Save signal results (FIX #7)
    if engine_result.signals_fired:
        _save_signal_results(conn, player_id, game_date, prop_type,
                           prizepicks_line, final, edge_pct,
                           engine_result.signals_fired, engine_result.direction)

    return {
        "player_id": player_id, "game_date": game_date, "prop_type": prop_type,
        "baseline_projection": round(baseline, 2), "signal_delta": round(signal_delta, 4),
        "final_projection": final, "prizepicks_line": prizepicks_line,
        "edge_pct": edge_pct, "confidence_tier": tier, "kelly_stake": kelly,
        "signals_fired": engine_result.signals_fired, "direction": engine_result.direction,
    }


def _save_projection(proj, conn):
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO projection_outputs
                (player_id, game_date, prop_type, baseline_projection,
                 signal_delta, final_projection, prizepicks_line,
                 edge_pct, confidence_tier, kelly_stake, signals_fired, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT DO NOTHING
        """, (
            proj["player_id"], proj["game_date"], proj["prop_type"],
            proj["baseline_projection"], proj["signal_delta"],
            proj["final_projection"], proj["prizepicks_line"],
            proj["edge_pct"], proj["confidence_tier"], proj["kelly_stake"],
            json.dumps(proj["signals_fired"]),
        ))
        cur.close()
        return True
    except Exception as e:
        logger.debug(f"Save projection failed: {e}")
        try:
            conn.rollback()
        except:
            pass
        return False


def run_daily(target_date=None, db_conn=None):
    if target_date is None:
        target_date = datetime.now().strftime("%Y-%m-%d")

    # Use AUTOCOMMIT so individual query failures don't cascade
    conn = db_conn or _get_db_connection(autocommit=True)
    if conn is None:
        logger.error("run_daily: no DB connection")
        return 0

    own_conn = db_conn is None
    engine = SignalEngine(db_conn=conn)
    written = 0
    signal_count = 0

    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT pdl.prizepicks_player_id, pdl.player_name, pdl.team,
                   pdl.stat_type, pdl.opening_line, pdl.opponent,
                   p.position, p.season_averages,
                   p.last_5_averages, p.last_10_averages,
                   p.home_averages, p.away_averages
            FROM prizepicks_daily_lines pdl
            LEFT JOIN players p ON LOWER(pdl.player_name) = LOWER(p.player_name)
            WHERE pdl.game_date = %s AND pdl.opening_line IS NOT NULL
        """, (target_date,))
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description]
        cur.close()
        logger.info(f"run_daily: processing {len(rows)} lines for {target_date}")

        # Caches
        team_injury_cache = {}
        team_b2b_cache = {}
        player_stats_cache = {}
        game_ctx_cache = {}

        for row in rows:
            data = dict(zip(columns, row))
            player_id = str(data.get("prizepicks_player_id") or data.get("player_name", ""))
            player_name = data.get("player_name", player_id)
            prop_type = data.get("stat_type", "Points")
            line = float(data.get("opening_line") or 0)
            team_id = data.get("team", "")
            opp_team_id = data.get("opponent", "")
            if line <= 0:
                continue

            # Enrichment (cached)
            if team_id not in team_injury_cache:
                team_injury_cache[team_id] = _enrich_injury_data(conn, team_id, target_date)
            injury_data = team_injury_cache[team_id]

            if team_id not in team_b2b_cache:
                team_b2b_cache[team_id] = _enrich_b2b_and_rest(conn, team_id, target_date)
            b2b_data = team_b2b_cache[team_id]

            if player_name not in player_stats_cache:
                player_stats_cache[player_name] = _enrich_recent_stats(conn, player_name, target_date)
            recent_stats = player_stats_cache[player_name]

            # Enrich referee data for this game
            ref_key = f"{target_date}_{team_id}_{opp_team_id}"
            if ref_key not in getattr(run_daily, '_ref_cache', {}):
                if not hasattr(run_daily, '_ref_cache'):
                    run_daily._ref_cache = {}
                run_daily._ref_cache[ref_key] = _enrich_referee_data(conn, target_date, team_id, opp_team_id)
            ref_data = run_daily._ref_cache.get(ref_key, {})

            # Enrich matchup history
            matchup_hist = _enrich_matchup_history(conn, player_name, opp_team_id, target_date)

            # Enrich defender data
            defender_info = _enrich_defender_data(conn, player_name, opp_team_id, data.get("position", ""))

            ck = f"{team_id}_{opp_team_id}"
            if ck not in game_ctx_cache:
                game_ctx_cache[ck] = _enrich_game_context_data(conn, target_date, team_id)
            game_ctx = game_ctx_cache[ck]

            extra = {
                "team_id": team_id, "opp_team_id": opp_team_id,
                "position": data.get("position", ""),
                "season_averages": _normalize_averages(data.get("season_averages") or {}),
                "player_name": player_name,
                "absent_players": injury_data.get("absent_players", []),
                # injured_teammates is the key InjuryAlphaSignal reads; alias absent_players
                "injured_teammates": injury_data.get("absent_players", []),
                "out_players": injury_data.get("out_players", []),
                "injury_boosts": injury_data.get("injury_boosts", {}),
                "is_b2b": b2b_data.get("is_b2b", False) or game_ctx.get("is_b2b", False),
                # rest_days=None when no game data — rest_days signal will not fire
                "rest_days": b2b_data.get("rest_days"),
                "home_game": b2b_data.get("home_game"),
                "is_home": b2b_data.get("home_game"),
                "last_5_averages": _normalize_averages(data.get("last_5_averages") or recent_stats.get("last_5_averages") or {}),
                "last_10_averages": _normalize_averages(data.get("last_10_averages") or recent_stats.get("last_10_averages") or {}),
                "spread": game_ctx.get("spread"),
                "projected_total": game_ctx.get("projected_total"),
                "referee_crew": ref_data.get("referee_crew", []),
                # Home/away splits (feeds home_away signal)
                "referee_names": ref_data.get("referee_names", []),
                "game_referees": ref_data.get("game_referees", []),
                "vs_team_history": matchup_hist,
                "primary_defender": defender_info.get("primary_defender", ""),
                "defender_stats": defender_info.get("defender_stats", {}),
                "home_averages": _normalize_averages(data.get("home_averages") or recent_stats.get("home_averages") or {}),
                "away_averages": _normalize_averages(data.get("away_averages") or recent_stats.get("away_averages") or {}),
                # Minutes load (feeds fatigue signal)
                "minutes_last_7": recent_stats.get("minutes_last_7"),
                "minutes_last_14": recent_stats.get("minutes_last_14"),
            }

            proj = project_player(
                player_id=player_id, game_date=target_date,
                prop_type=prop_type, prizepicks_line=line,
                game_context_extra=extra, signal_engine=engine, conn=conn,
            )

            if proj:
                if proj.get("signals_fired"):
                    signal_count += len(proj["signals_fired"])
                if _save_projection(proj, conn):
                    written += 1

        logger.info(f"run_daily complete: {written} projections, {signal_count} signal firings")

    except Exception as e:
        logger.error(f"run_daily failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if own_conn:
            conn.close()

    return written


def get_today_projections(game_date=None, db_conn=None):
    if game_date is None:
        game_date = datetime.now().strftime("%Y-%m-%d")
    conn = db_conn or _get_db_connection()
    if conn is None:
        return []
    own_conn = db_conn is None
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT po.*, p.player_name
            FROM projection_outputs po
            LEFT JOIN players p ON po.player_id = p.id
            WHERE po.game_date = %s ORDER BY ABS(po.edge_pct) DESC
        """, (game_date,))
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        cur.close()
        return [dict(zip(cols, row)) for row in rows]
    except Exception as e:
        logger.error(f"get_today_projections failed: {e}")
        return []
    finally:
        if own_conn:
            conn.close()


if __name__ == "__main__":
    import argparse
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Projection Engine")
    parser.add_argument("--date", default=None, help="Target date YYYY-MM-DD")
    args = parser.parse_args()
    count = run_daily(target_date=args.date)
    print(f"Projections written: {count}")
