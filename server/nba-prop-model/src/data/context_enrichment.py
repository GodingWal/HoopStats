#!/usr/bin/env python3
"""
Context Enrichment v5 - Uses players table JSON fields for reliable data.
Each enrichment step uses savepoints for error recovery.
"""
import json, logging
from datetime import datetime, timedelta
from typing import Dict, Any

logger = logging.getLogger(__name__)


def _safe_enrich(conn, cursor, name, func, *args):
    try:
        cursor.execute("SAVEPOINT enrich_sp")
        func(cursor, *args)
    except Exception as e:
        try: cursor.execute("ROLLBACK TO SAVEPOINT enrich_sp")
        except: pass
        logger.debug(f"{name}: {e}")
    finally:
        try: cursor.execute("RELEASE SAVEPOINT enrich_sp")
        except: pass


def _parse_date(game_date):
    """Convert game_date to datetime, handling both str and date objects."""
    if isinstance(game_date, str):
        return datetime.strptime(game_date, '%Y-%m-%d')
    if hasattr(game_date, 'year'):
        return datetime(game_date.year, game_date.month, game_date.day)
    return datetime.strptime(str(game_date), '%Y-%m-%d')


def _parse_game_date_str(gd_str):
    """Parse game date strings like 'MAR 21, 2026' or '2026-03-21'."""
    if not gd_str:
        return None
    try:
        if len(gd_str) == 10 and gd_str[4] == '-':
            return datetime.strptime(gd_str, '%Y-%m-%d')
        return datetime.strptime(gd_str, '%b %d, %Y')
    except:
        return None


def _normalize_keys(d):
    """Lowercase all dict keys."""
    if not isinstance(d, dict):
        return d
    return {k.lower(): v for k, v in d.items()}


def enrich_context(conn, context: Dict[str, Any], player_data: Dict[str, Any]) -> Dict[str, Any]:
    """Enrich context with all data signals need."""
    cursor = conn.cursor()
    player_name = player_data.get('player_name', '')
    team = player_data.get('team', '') or context.get('team', '')
    opponent = player_data.get('opponent', '') or context.get('opponent', '')
    game_date = str(player_data.get('game_date', '') or context.get('game_date', ''))
    stat_type = player_data.get('stat_type', '') or context.get('stat_type', '')
    position = player_data.get('position', '') or context.get('player_position', '')
    
    context.setdefault('player_name', player_name)
    context.setdefault('team', team)
    context.setdefault('team_id', team)
    context.setdefault('opp_team_id', opponent)
    context.setdefault('opponent', opponent)
    context.setdefault('opponent_team', opponent)
    context.setdefault('game_date', game_date)
    if position:
        context['player_position'] = position
        context['position'] = position

    # Get game_logs from players table (rich JSON data)
    game_logs = player_data.get('game_logs') or context.get('game_logs')
    if game_logs is None:
        _safe_enrich(conn, cursor, "load_logs", _load_game_logs, context, player_name)
        game_logs = context.get('_game_logs', [])
    else:
        if isinstance(game_logs, str):
            try: game_logs = json.loads(game_logs)
            except: game_logs = []
        context['_game_logs'] = game_logs

    # Get vs_team data
    vs_team = player_data.get('vs_team')
    if vs_team is None:
        _safe_enrich(conn, cursor, "load_vs", _load_vs_team, context, player_name)
    else:
        if isinstance(vs_team, str):
            try: vs_team = json.loads(vs_team)
            except: vs_team = {}
        context['_vs_team'] = vs_team

    _safe_enrich(conn, cursor, "home_away", _enrich_home_away, context, team, opponent, game_date)
    _safe_enrich(conn, cursor, "b2b", _enrich_b2b, context, team, game_date)
    _safe_enrich(conn, cursor, "opponent_stats", _enrich_opponent_stats, context, opponent)
    _enrich_fatigue_from_logs(context, game_date)  # No DB needed
    _safe_enrich(conn, cursor, "line_movement", _enrich_line_movement, context, player_name, game_date, stat_type)
    _safe_enrich(conn, cursor, "injuries", _enrich_injuries, context, team, player_name, game_date)
    _enrich_matchup_from_vs_team(context, opponent)  # No DB needed
    _safe_enrich(conn, cursor, "referee", _enrich_referee_data, context, team, opponent, game_date)
    _safe_enrich(conn, cursor, "defense_vs_pos", _enrich_defense_vs_position, context, opponent, position)
    _safe_enrich(conn, cursor, "team_win_data", _enrich_team_win_data, context, team, opponent)
    
    # Clean up internal fields
    context.pop('_game_logs', None)
    context.pop('_vs_team', None)
    
    try: cursor.close()
    except: pass
    return context


def _load_game_logs(cursor, context, player_name):
    cursor.execute("SELECT game_logs, vs_team FROM players WHERE LOWER(player_name) = LOWER(%s) LIMIT 1", (player_name,))
    row = cursor.fetchone()
    if row:
        gl = row[0]
        if isinstance(gl, str):
            try: gl = json.loads(gl)
            except: gl = []
        context['_game_logs'] = gl or []
        vt = row[1]
        if isinstance(vt, str):
            try: vt = json.loads(vt)
            except: vt = {}
        context['_vs_team'] = vt or {}


def _load_vs_team(cursor, context, player_name):
    if '_vs_team' in context:
        return
    cursor.execute("SELECT vs_team FROM players WHERE LOWER(player_name) = LOWER(%s) LIMIT 1", (player_name,))
    row = cursor.fetchone()
    if row and row[0]:
        vt = row[0]
        if isinstance(vt, str):
            try: vt = json.loads(vt)
            except: vt = {}
        context['_vs_team'] = vt


def _enrich_home_away(cursor, context, team, opponent, game_date):
    if context.get('is_home') is not None:
        return
    # First try game_logs - most recent game has IS_HOME
    logs = context.get('_game_logs', [])
    # game_logs don't directly tell us about TODAY's game
    # Use games_schedule table
    cursor.execute("""
        SELECT home_team, away_team FROM games_schedule 
        WHERE game_date = %s AND ((home_team = %s AND away_team = %s) OR (home_team = %s AND away_team = %s))
        LIMIT 1
    """, (game_date, team, opponent, opponent, team))
    row = cursor.fetchone()
    if row:
        context['is_home'] = (row[0] == team)
    else:
        cursor.execute("SELECT 1 FROM games_schedule WHERE game_date = %s AND home_team = %s LIMIT 1", (game_date, team))
        if cursor.fetchone():
            context['is_home'] = True
        else:
            cursor.execute("SELECT 1 FROM games_schedule WHERE game_date = %s AND away_team = %s LIMIT 1", (game_date, team))
            if cursor.fetchone():
                context['is_home'] = False


def _enrich_b2b(cursor, context, team, game_date):
    if context.get('is_b2b') is not None:
        return
    gd = _parse_date(game_date)
    yesterday = (gd - timedelta(days=1)).strftime('%Y-%m-%d')
    cursor.execute("SELECT COUNT(*) FROM games_schedule WHERE game_date = %s AND (home_team = %s OR away_team = %s)", (yesterday, team, team))
    row = cursor.fetchone()
    context['is_b2b'] = (row[0] > 0) if row else False
    if context['is_b2b']:
        context['rest_days'] = 0
    else:
        two_days = (gd - timedelta(days=2)).strftime('%Y-%m-%d')
        cursor.execute("SELECT COUNT(*) FROM games_schedule WHERE game_date = %s AND (home_team = %s OR away_team = %s)", (two_days, team, team))
        row = cursor.fetchone()
        context['rest_days'] = 1 if (row and row[0] > 0) else 2


def _enrich_opponent_stats(cursor, context, opponent):
    cursor.execute("""
        SELECT pace, def_rating, off_rating, def_vs_pg, def_vs_sg, def_vs_sf, def_vs_pf, def_vs_c, net_rating
        FROM team_stats WHERE UPPER(team_id) = UPPER(%s) LIMIT 1
    """, (opponent,))
    row = cursor.fetchone()
    if row:
        pace, def_r, off_r, dvpg, dvsg, dvsf, dvpf, dvc, net = row
        context['opponent_pace'] = float(pace or 100)
        context['opponent_pace_rank'] = 15
        context['opponent_def_rating'] = float(def_r or 110)
        context['opponent_stats'] = {'pace': float(pace or 100), 'def_rating': float(def_r or 110), 'off_rating': float(off_r or 110), 'net_rating': float(net or 0)}
        context['opponent_def_vs_position'] = {'PG': float(dvpg or 0), 'SG': float(dvsg or 0), 'SF': float(dvsf or 0), 'PF': float(dvpf or 0), 'C': float(dvc or 0)}


def _enrich_fatigue_from_logs(context, game_date):
    """Calculate fatigue from game_logs JSON - no DB query needed."""
    logs = context.get('_game_logs') or context.get('recent_games') or []
    if isinstance(logs, str):
        try: logs = json.loads(logs)
        except: return
    if not logs:
        return

    gd = _parse_date(game_date)
    d7 = gd - timedelta(days=7)
    d14 = gd - timedelta(days=14)

    min7, min14, count7, count14 = 0.0, 0.0, 0, 0
    recent_schedule = []

    for g in logs[:20]:
        g = _normalize_keys(g)
        gdate = _parse_game_date_str(g.get('game_date', ''))
        if gdate is None:
            continue
        mins = float(g.get('min', 0) or 0)
        if gdate >= d7 and gdate < gd:
            min7 += mins
            count7 += 1
        if gdate >= d14 and gdate < gd:
            min14 += mins
            count14 += 1
        if gdate < gd and len(recent_schedule) < 5:
            recent_schedule.append({'game_date': gdate.strftime('%Y-%m-%d'), 'minutes': mins})

    context['minutes_last_7'] = min7
    context['minutes_last_14'] = min14
    context['games_last_7'] = count7
    context['games_last_14'] = count14
    if recent_schedule:
        context['recent_schedule'] = recent_schedule
        mins_list = [s['minutes'] for s in recent_schedule if s['minutes'] > 0]
        if mins_list:
            context['avg_minutes'] = sum(mins_list) / len(mins_list)


def _enrich_line_movement(cursor, context, player_name, game_date, stat_type):
    # First check prizepicks_line_movements
    cursor.execute("""
        SELECT old_line, new_line, detected_at FROM prizepicks_line_movements
        WHERE LOWER(player_name) = LOWER(%s) AND stat_type = %s AND game_time::date = %s::date
        ORDER BY detected_at ASC
    """, (player_name, stat_type, game_date))
    rows = cursor.fetchall()
    if rows:
        context['opening_line'] = float(rows[0][0]) if rows[0][0] else None
        context['current_line'] = float(rows[-1][1]) if rows[-1][1] else None
        context['line_history'] = [
            {'old_line': float(r[0]) if r[0] else None, 'new_line': float(r[1]) if r[1] else None,
             'changed_at': r[2].isoformat() if hasattr(r[2], 'isoformat') else str(r[2])} for r in rows
        ]
    else:
        # Fallback: use prizepicks_daily_lines opening/closing
        cursor.execute("""
            SELECT opening_line, closing_line FROM prizepicks_daily_lines
            WHERE LOWER(player_name) = LOWER(%s) AND stat_type = %s AND game_date = %s::date
            LIMIT 1
        """, (player_name, stat_type, game_date))
        row = cursor.fetchone()
        if row:
            ol = float(row[0]) if row[0] else None
            cl = float(row[1]) if row[1] else None
            if ol and cl and ol != cl:
                context['opening_line'] = ol
                context['current_line'] = cl
            elif ol:
                context['opening_line'] = ol
                context['current_line'] = ol


def _enrich_injuries(cursor, context, team, player_name, game_date):
    cursor.execute("""
        SELECT player_name, player_id, status, injury_detail FROM injury_report
        WHERE team = %s AND game_date = %s AND status IN ('Out', 'Suspended')
    """, (team, game_date))
    rows = cursor.fetchall()
    if not rows:
        cursor.execute("""
            SELECT player_name, player_id, status, description FROM player_injuries
            WHERE team = %s AND is_active = true AND status IN ('Out', 'Suspended')
        """, (team,))
        rows = cursor.fetchall()
    
    if rows:
        injured = [{'name': r[0], 'player_id': str(r[1]), 'status': r[2]} for r in rows]
        context['injured_teammates'] = [i for i in injured if i['name'].lower() != player_name.lower()]
        context['out_players'] = [i['name'] for i in context['injured_teammates']]
        boosts = {}
        for r in rows:
            if r[0].lower() == player_name.lower():
                continue
            cursor.execute("SELECT season_averages FROM players WHERE LOWER(player_name) = LOWER(%s) LIMIT 1", (r[0],))
            pr = cursor.fetchone()
            if pr and pr[0]:
                sa = pr[0] if isinstance(pr[0], dict) else json.loads(pr[0]) if isinstance(pr[0], str) else {}
                sa = _normalize_keys(sa)
                boosts[r[0]] = {'pts': float(sa.get('pts', 0) or 0), 'reb': float(sa.get('reb', 0) or 0), 'ast': float(sa.get('ast', 0) or 0)}
        if boosts:
            context['injury_boosts'] = boosts
            context['usage_redistribution'] = boosts
    else:
        context['injured_teammates'] = []
        context['out_players'] = []


def _enrich_matchup_from_vs_team(context, opponent):
    """Use vs_team JSON from players table for matchup history."""
    vs_team = context.get('_vs_team') or {}
    if isinstance(vs_team, str):
        try: vs_team = json.loads(vs_team)
        except: return
    if not vs_team:
        return
    
    # Try exact match, then partial match (e.g., "DET" vs "DET")
    opp_key = opponent.upper()
    opp_data = vs_team.get(opp_key) or vs_team.get(opponent)
    
    if not opp_data:
        # Try shorter forms: "GS" for "GSW", "NO" for "NOP", etc.
        abbrev_map = {'GSW': 'GS', 'NOP': 'NO', 'SAS': 'SA', 'PHX': 'PHO', 'NYK': 'NY', 'BKN': 'BK'}
        alt = abbrev_map.get(opp_key, '')
        if alt:
            opp_data = vs_team.get(alt)
    
    if opp_data:
        opp_data = _normalize_keys(opp_data)
        games_count = int(opp_data.get('games', 0))
        if games_count >= 1:
            # Build vs_team_history as list of fake game entries
            context['vs_team_history'] = [
                {'pts': float(opp_data.get('pts', 0) or 0),
                 'reb': float(opp_data.get('reb', 0) or 0),
                 'ast': float(opp_data.get('ast', 0) or 0),
                 'fg3m': float(opp_data.get('fg3m', 0) or 0),
                 'minutes': 30.0,
                 'game_date': '2026-01-01'}
            ] * games_count  # Repeat for sample size


def _enrich_defense_vs_position(cursor, context, opponent, position):
    if not position or not opponent:
        return
    pos_map = {'PG': 'PG', 'SG': 'SG', 'SF': 'SF', 'PF': 'PF', 'C': 'C', 'G': 'PG', 'F': 'SF'}
    raw = position.upper().split('-')[0] if '-' in position else position.upper()
    norm_pos = pos_map.get(raw, 'SF')
    
    cursor.execute("""
        SELECT pts_allowed, reb_allowed, ast_allowed, fg_pct_allowed
        FROM team_defense_by_position WHERE team_id = %s AND position = %s LIMIT 1
    """, (opponent, norm_pos))
    row = cursor.fetchone()
    if row:
        context['opp_positional_def'] = {
            'pts_allowed': float(row[0] or 0), 'reb_allowed': float(row[1] or 0),
            'ast_allowed': float(row[2] or 0), 'fg_pct_allowed': float(row[3] or 0),
            'defensive_rating': 110.0, 'sample_size': 20,
        }


def _enrich_referee_data(cursor, context, team, opponent, game_date):
    """Load referee assignments for this game and add to context."""
    if not game_date:
        return
    if not team and not opponent:
        return
    teams = [t for t in [team, opponent] if t]
    placeholders = ' OR '.join(['home_team = %s OR away_team = %s'] * len(teams))
    params = [game_date]
    for t in teams:
        params.extend([t, t])
    cursor.execute(f"""
        SELECT DISTINCT referee_name, avg_fouls_per_game
        FROM referee_assignments
        WHERE game_date = %s::date AND ({placeholders})
        LIMIT 5
    """, params)
    rows = cursor.fetchall()
    if rows:
        referee_names = [r[0] for r in rows if r[0] and r[0] != 'TBD']
        game_referees = [
            {'name': r[0], 'avg_fouls_per_game': float(r[1]) if r[1] else 42.0}
            for r in rows if r[0] and r[0] != 'TBD'
        ]
        if referee_names:
            context['referee_names'] = referee_names
            context['game_referees'] = game_referees
            context['referee_crew'] = referee_names


def _enrich_team_win_data(cursor, context, team, opponent):
    """Enrich context with team net ratings and win% for win_probability signal."""
    if not team:
        return
    cursor.execute(
        """SELECT net_rating, off_rating, def_rating, wins, losses
        FROM team_stats WHERE UPPER(team_id) = UPPER(%s) LIMIT 1""",
        (team,)
    )
    row = cursor.fetchone()
    if row:
        net_r, off_r, def_r, wins, losses = row
        context['team_net_rating'] = float(net_r or 0)
        context['team_stats'] = {
            'net_rating': float(net_r or 0),
            'off_rating': float(off_r or 110),
            'def_rating': float(def_r or 110),
        }
        total_games = (wins or 0) + (losses or 0)
        if total_games > 0:
            context['team_win_pct'] = float(wins or 0) / total_games
        else:
            context['team_win_pct'] = 0.5

    if not context.get('opp_net_rating'):
        cursor.execute(
            """SELECT net_rating, wins, losses
            FROM team_stats WHERE UPPER(team_id) = UPPER(%s) LIMIT 1""",
            (opponent,)
        )
        row = cursor.fetchone()
        if row:
            context['opp_net_rating'] = float(row[0] or 0)
            total_games = (row[1] or 0) + (row[2] or 0)
            if total_games > 0:
                context['opp_win_pct'] = float(row[1] or 0) / total_games
            else:
                context['opp_win_pct'] = 0.5

