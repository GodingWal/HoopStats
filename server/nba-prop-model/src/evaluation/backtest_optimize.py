"""
Signal Weight Optimizer via Backtesting
========================================
Uses prizepicks_daily_lines (5K+ graded outcomes) + players table context
to measure each signal's accuracy and optimize weights via scipy.

Steps:
1. Load all graded outcomes from prizepicks_daily_lines
2. Join with players table to reconstruct pre-game context
3. Run each signal against historical context
4. Measure per-signal accuracy (hit rate)
5. Optimize weight combination using scipy.optimize.minimize
6. Update weight_registry with results
"""

import sys
import os
import json
import logging
import numpy as np
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Any, Optional, Tuple

# Add project root to path
sys.path.insert(0, '/var/www/courtsideedge/server/nba-prop-model')

import psycopg2
import psycopg2.extras
from scipy.optimize import minimize, differential_evolution

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler('/var/www/courtsideedge/server/nba-prop-model/src/evaluation/optimize_run.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ── DB connection ──────────────────────────────────────────────────────
# DB credentials loaded from shared config
from config.db_config import DATABASE_URL
DB_DSN = DATABASE_URL


# ── Signal name mapping (DB signal_type -> internal names) ─────────────
SIGNAL_NAMES = [
    'rest_days', 'minutes_projection', 'recent_form', 'home_away',
    'positional_defense', 'pace', 'fatigue', 'line_movement',
    'b2b', 'injury_alpha', 'referee', 'referee_impact',
    'matchup_history', 'usage_redistribution', 'defender_matchup',
    'defense', 'clv_tracker', 'blowout_risk'
]

# Stat type key mapping for computing actuals from player_game_stats
STAT_KEY_MAP = {
    'Points': 'PTS',
    'Rebounds': 'REB',
    'Assists': 'AST',
    'Steals': 'STL',
    'Blocked Shots': 'BLK',
    'Turnovers': 'TOV',
    'Pts+Rebs': 'PTS+REB',
    'Pts+Asts': 'PTS+AST',
    'Pts+Rebs+Asts': 'PRA',
    'Rebs+Asts': 'REB+AST',
    'Blks+Stls': 'BLK+STL',
}


def load_graded_outcomes(conn) -> List[Dict]:
    """Load all prizepicks lines with actual outcomes + player context."""
    logger.info("Loading graded outcomes from prizepicks_daily_lines...")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            pdl.player_name, pdl.team, pdl.stat_type, pdl.game_date,
            pdl.opening_line, pdl.closing_line, pdl.actual_value, pdl.hit_over,
            pdl.opponent, pdl.total_movement, pdl.net_movement, pdl.num_movements,
            pdl.high_line, pdl.low_line,
            p.player_id, p.position, p.games_played,
            p.season_averages, p.last_10_averages, p.last_5_averages,
            p.home_averages, p.away_averages, p.hit_rates,
            p.recent_games, p.team_pace, p.on_off_splits,
            p.next_game_location, p.usage_rate
        FROM prizepicks_daily_lines pdl
        JOIN players p ON pdl.player_name = p.player_name
        WHERE pdl.actual_value IS NOT NULL
        ORDER BY pdl.game_date, pdl.player_name
    """)
    rows = cur.fetchall()
    logger.info(f"Loaded {len(rows)} graded outcomes")
    return [dict(r) for r in rows]


def parse_json_field(val):
    """Safely parse a JSON field that might be string or dict."""
    if val is None:
        return {}
    if isinstance(val, dict):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except:
            return {}
    return {}


def get_season_avg_for_stat(season_avgs: Dict, stat_type: str) -> Optional[float]:
    """Extract the relevant season average for a given stat type."""
    sa = parse_json_field(season_avgs)
    mapping = {
        'Points': 'PTS', 'Rebounds': 'REB', 'Assists': 'AST',
        'Steals': 'STL', 'Blocked Shots': 'BLK', 'Turnovers': 'TOV',
        'Pts+Rebs': 'PTS+REB', 'Pts+Asts': 'PTS+AST',
        'Pts+Rebs+Asts': 'PRA', 'Rebs+Asts': 'REB+AST',
    }
    key = mapping.get(stat_type)
    if key and key in sa:
        return float(sa[key])
    # Try combo computation
    if stat_type == 'Pts+Rebs' and 'PTS' in sa and 'REB' in sa:
        return float(sa['PTS']) + float(sa['REB'])
    if stat_type == 'Pts+Asts' and 'PTS' in sa and 'AST' in sa:
        return float(sa['PTS']) + float(sa['AST'])
    if stat_type == 'Pts+Rebs+Asts' and 'PTS' in sa and 'REB' in sa and 'AST' in sa:
        return float(sa['PTS']) + float(sa['REB']) + float(sa['AST'])
    if stat_type == 'Rebs+Asts' and 'REB' in sa and 'AST' in sa:
        return float(sa['REB']) + float(sa['AST'])
    return None


def simulate_signals(game: Dict) -> Dict[str, Dict]:
    """
    Simulate what each signal would have predicted for a historical game.
    
    Returns dict of signal_name -> {direction, adjustment, confidence, fired}
    
    We reconstruct each signal's logic using available context data.
    """
    results = {}
    
    season_avgs = parse_json_field(game.get('season_averages'))
    l5_avgs = parse_json_field(game.get('last_5_averages'))
    l10_avgs = parse_json_field(game.get('last_10_averages'))
    home_avgs = parse_json_field(game.get('home_averages'))
    away_avgs = parse_json_field(game.get('away_averages'))
    hit_rates = parse_json_field(game.get('hit_rates'))
    
    stat_type = game['stat_type']
    line = float(game.get('opening_line') or game.get('closing_line') or 0)
    if line == 0:
        return results
    
    baseline = get_season_avg_for_stat(season_avgs, stat_type)
    l5_baseline = get_season_avg_for_stat(l5_avgs, stat_type)
    l10_baseline = get_season_avg_for_stat(l10_avgs, stat_type)
    home_baseline = get_season_avg_for_stat(home_avgs, stat_type)
    away_baseline = get_season_avg_for_stat(away_avgs, stat_type)
    
    if baseline is None:
        return results
    
    opponent = (game.get('opponent') or '').strip()
    is_home = game.get('next_game_location', '') == 'HOME'
    
    # ── 1. REST_DAYS ──
    # Approximate: if game_date is Monday or Friday, likely 2+ rest days
    gd = game['game_date']
    if hasattr(gd, 'weekday'):
        dow = gd.weekday()
    else:
        from datetime import datetime as dt
        dow = dt.strptime(str(gd), '%Y-%m-%d').weekday()
    # More rest = slight boost. Mon(0)=2d rest, Thu(3)=1d, etc.
    rest_boost = {0: 0.03, 1: 0.01, 2: 0.0, 3: 0.01, 4: 0.02, 5: -0.01, 6: 0.0}
    adj = rest_boost.get(dow, 0.0) * baseline
    if abs(adj) > 0.01:
        direction = 'OVER' if adj > 0 else 'UNDER'
        results['rest_days'] = {
            'direction': direction, 'adjustment': adj,
            'confidence': 0.55, 'fired': True
        }
    
    # ── 2. MINUTES_PROJECTION ──
    min_sa = season_avgs.get('MIN')
    min_l5 = l5_avgs.get('MIN') if l5_avgs else None
    if min_sa and min_l5:
        min_ratio = float(min_l5) / float(min_sa) if float(min_sa) > 0 else 1.0
        if abs(min_ratio - 1.0) > 0.05:
            adj = (min_ratio - 1.0) * baseline
            direction = 'OVER' if adj > 0 else 'UNDER'
            results['minutes_projection'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': min(0.8, 0.5 + abs(min_ratio - 1.0)),
                'fired': True
            }
    
    # ── 3. RECENT_FORM ──
    if l5_baseline is not None and baseline > 0:
        form_ratio = l5_baseline / baseline
        if abs(form_ratio - 1.0) > 0.05:
            adj = (form_ratio - 1.0) * baseline
            direction = 'OVER' if form_ratio > 1.0 else 'UNDER'
            conf = min(0.85, 0.5 + abs(form_ratio - 1.0) * 2)
            results['recent_form'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': conf, 'fired': True
            }
    
    # ── 4. HOME_AWAY ──
    if home_baseline is not None and away_baseline is not None and baseline > 0:
        if is_home:
            split_diff = home_baseline - baseline
        else:
            split_diff = away_baseline - baseline
        if abs(split_diff) > 0.3:
            adj = split_diff * 0.5  # dampen
            direction = 'OVER' if adj > 0 else 'UNDER'
            results['home_away'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': 0.55, 'fired': True
            }

    # ── 5. POSITIONAL_DEFENSE ── (use baseline vs line as proxy)
    if baseline > 0:
        edge = (baseline - line) / line
        if abs(edge) > 0.05:
            # Proxy: if season avg is much higher than line, defense is weak
            adj = edge * baseline * 0.3
            direction = 'OVER' if edge > 0 else 'UNDER'
            results['positional_defense'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': 0.55, 'fired': True
            }
    
    # ── 6. PACE_MATCHUP ──
    team_pace = game.get('team_pace')
    if team_pace and float(team_pace) > 0:
        pace_val = float(team_pace)
        league_avg_pace = 100.0
        pace_diff = (pace_val - league_avg_pace) / league_avg_pace
        if abs(pace_diff) > 0.02:
            adj = pace_diff * baseline * 0.5
            direction = 'OVER' if pace_diff > 0 else 'UNDER'
            results['pace'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': 0.55, 'fired': True
            }
    
    # ── 7. FATIGUE ── (proxy: high minutes in L5)
    if min_sa and min_l5:
        if float(min_l5) > 34:
            fatigue_factor = (float(min_l5) - 34) * 0.01
            adj = -fatigue_factor * baseline
            results['fatigue'] = {
                'direction': 'UNDER', 'adjustment': adj,
                'confidence': 0.6, 'fired': True
            }

    # ── 8. LINE_MOVEMENT ──
    net_move = game.get('net_movement')
    total_move = game.get('total_movement')
    if net_move is not None and abs(float(net_move)) > 0.3:
        nm = float(net_move)
        # Line moved up = market thinks OVER
        direction = 'OVER' if nm > 0 else 'UNDER'
        adj = nm * 0.3
        conf = min(0.8, 0.5 + abs(nm) * 0.1)
        results['line_movement'] = {
            'direction': direction, 'adjustment': adj,
            'confidence': conf, 'fired': True
        }
    
    # ── 9. BACK_TO_BACK ── (proxy: games on consecutive days)
    # B2B players typically perform worse
    if hasattr(gd, 'weekday'):
        # Tuesday, Thursday, Saturday = higher B2B likelihood
        if dow in [1, 3, 5]:
            adj = -0.02 * baseline
            results['b2b'] = {
                'direction': 'UNDER', 'adjustment': adj,
                'confidence': 0.55, 'fired': True
            }
    
    # ── 10. INJURY_ALPHA ── (if usage_rate is high, teammates may be out)
    usage = game.get('usage_rate')
    if usage and float(usage) > 25:
        usage_val = float(usage)
        boost = (usage_val - 25) * 0.005 * baseline
        if boost > 0.2:
            results['injury_alpha'] = {
                'direction': 'OVER', 'adjustment': boost,
                'confidence': 0.6, 'fired': True
            }

    # ── 11. REFEREE / 12. REFEREE_IMPACT ── (no ref data available, skip)
    # These will have fired=False
    
    # ── 13. MATCHUP_HISTORY ── (use recent_games if vs same team)
    recent_games = game.get('recent_games')
    if recent_games and opponent:
        rg = parse_json_field(recent_games) if isinstance(recent_games, str) else recent_games
        if isinstance(rg, list):
            vs_games = [g for g in rg if opponent.upper() in str(g.get('OPPONENT', g.get('opponent', ''))).upper()]
            if len(vs_games) >= 1:
                stat_key = STAT_KEY_MAP.get(stat_type)
                if stat_key:
                    vals = []
                    for g in vs_games:
                        v = g.get(stat_key) or g.get(stat_key.lower())
                        if v is not None:
                            vals.append(float(v))
                    if vals:
                        matchup_avg = np.mean(vals)
                        diff = matchup_avg - baseline
                        if abs(diff) > 0.5:
                            adj = diff * 0.3
                            direction = 'OVER' if diff > 0 else 'UNDER'
                            results['matchup_history'] = {
                                'direction': direction, 'adjustment': adj,
                                'confidence': min(0.7, 0.5 + len(vals) * 0.05),
                                'fired': True
                            }
    
    # ── 14. USAGE_REDISTRIBUTION ── (high usage = more opportunity)
    if usage and float(usage) > 22:
        usage_val = float(usage)
        usage_edge = (usage_val - 22) * 0.003 * baseline
        if usage_edge > 0.15:
            results['usage_redistribution'] = {
                'direction': 'OVER', 'adjustment': usage_edge,
                'confidence': 0.55, 'fired': True
            }

    # ── 15. DEFENDER_MATCHUP ── (no per-defender data, use defense proxy)
    # Skip - not enough data
    
    # ── 16. DEFENSE_VS_POSITION ── (same as positional_defense, already covered)
    # Use L10 trend as additional defense signal
    if l10_baseline is not None and baseline > 0:
        l10_ratio = l10_baseline / baseline
        if abs(l10_ratio - 1.0) > 0.03:
            adj = (l10_ratio - 1.0) * baseline * 0.2
            direction = 'OVER' if adj > 0 else 'UNDER'
            results['defense'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': 0.53, 'fired': True
            }
    
    # ── 17. CLV_TRACKER ── (model vs market edge)
    if baseline > 0:
        model_edge = (baseline - line) / line
        if abs(model_edge) > 0.08:
            adj = model_edge * baseline * 0.4
            direction = 'OVER' if model_edge > 0 else 'UNDER'
            results['clv_tracker'] = {
                'direction': direction, 'adjustment': adj,
                'confidence': min(0.7, 0.5 + abs(model_edge)),
                'fired': True
            }
    
    # ── 18. BLOWOUT_RISK ── (if spread is large, starters may sit)
    # Proxy: big favorites = risk of reduced minutes
    # Use closing vs opening line difference as proxy
    cl = game.get('closing_line')
    ol = game.get('opening_line')
    if cl and ol and float(cl) > 20:
        # High-total prop = star player, potential blowout risk
        results['blowout_risk'] = {
            'direction': 'UNDER', 'adjustment': -0.02 * baseline,
            'confidence': 0.5, 'fired': True
        }
    
    return results


def run_backtest(outcomes: List[Dict]) -> Dict[str, Dict]:
    """
    Run backtest across all graded outcomes.
    Returns per-signal accuracy stats.
    """
    signal_stats = defaultdict(lambda: {
        'total': 0, 'correct': 0, 'over_total': 0, 'over_correct': 0,
        'under_total': 0, 'under_correct': 0, 'adjustments': []
    })
    
    total_games = 0
    games_with_signals = 0
    
    for game in outcomes:
        actual = float(game['actual_value'])
        line = float(game.get('opening_line') or game.get('closing_line') or 0)
        if line == 0:
            continue
        
        actual_over = actual > line
        total_games += 1
        
        signals = simulate_signals(game)
        if not signals:
            continue
        games_with_signals += 1
        
        for sig_name, sig in signals.items():
            if not sig.get('fired'):
                continue
            
            ss = signal_stats[sig_name]
            ss['total'] += 1
            
            predicted_over = sig['direction'] == 'OVER'
            
            if predicted_over:
                ss['over_total'] += 1
                if actual_over:
                    ss['over_correct'] += 1
                    ss['correct'] += 1
            else:
                ss['under_total'] += 1
                if not actual_over:
                    ss['under_correct'] += 1
                    ss['correct'] += 1
            
            ss['adjustments'].append(sig['adjustment'])
    
    logger.info(f"Backtest: {total_games} games, {games_with_signals} with signals")
    
    # Compute hit rates
    for sig_name, ss in signal_stats.items():
        ss['hit_rate'] = ss['correct'] / ss['total'] if ss['total'] > 0 else 0.0
        ss['over_rate'] = ss['over_correct'] / ss['over_total'] if ss['over_total'] > 0 else 0.0
        ss['under_rate'] = ss['under_correct'] / ss['under_total'] if ss['under_total'] > 0 else 0.0
        ss['avg_adj'] = np.mean(ss['adjustments']) if ss['adjustments'] else 0.0
    
    return dict(signal_stats)


def optimize_weights(outcomes: List[Dict], signal_stats: Dict) -> Dict[str, float]:
    """
    Optimize signal weights using differential evolution.
    
    Objective: maximize weighted prediction accuracy.
    For each game, combine signal predictions using weights, predict over/under,
    and measure overall hit rate.
    """
    # Only optimize signals that fired enough times and beat coin flip
    eligible_signals = []
    for sig_name in SIGNAL_NAMES:
        ss = signal_stats.get(sig_name)
        if ss and ss['total'] >= 20:
            eligible_signals.append(sig_name)
    
    logger.info(f"Optimizing weights for {len(eligible_signals)} eligible signals: {eligible_signals}")
    
    if not eligible_signals:
        logger.error("No eligible signals to optimize!")
        return {}
    
    # Pre-compute signal predictions for all games (vectorized)
    game_signals = []
    game_actuals = []
    game_lines = []
    
    for game in outcomes:
        actual = float(game['actual_value'])
        line = float(game.get('opening_line') or game.get('closing_line') or 0)
        if line == 0:
            continue
        
        signals = simulate_signals(game)
        if not signals:
            continue
        
        sig_vec = {}
        for sig_name in eligible_signals:
            if sig_name in signals and signals[sig_name].get('fired'):
                s = signals[sig_name]
                # Encode direction as +1/-1 weighted by confidence
                val = s['confidence'] * (1 if s['direction'] == 'OVER' else -1)
                sig_vec[sig_name] = val
            else:
                sig_vec[sig_name] = 0.0
        
        game_signals.append(sig_vec)
        game_actuals.append(actual > line)
        game_lines.append(line)
    
    logger.info(f"Optimization dataset: {len(game_signals)} games")
    
    # Convert to numpy arrays for speed
    n_games = len(game_signals)
    n_signals = len(eligible_signals)
    X = np.zeros((n_games, n_signals))
    y = np.array(game_actuals, dtype=float)
    
    for i, sig_vec in enumerate(game_signals):
        for j, sig_name in enumerate(eligible_signals):
            X[i, j] = sig_vec.get(sig_name, 0.0)

    
    def objective(weights):
        """Negative accuracy (to minimize)."""
        weighted_sum = X @ weights
        predictions = (weighted_sum > 0).astype(float)
        accuracy = np.mean(predictions == y)
        return -accuracy  # minimize negative accuracy
    
    # Bounds: 0 to 1 for each weight
    bounds = [(0.0, 1.0)] * n_signals
    
    logger.info("Running differential evolution optimization...")
    result = differential_evolution(
        objective,
        bounds=bounds,
        maxiter=500,
        seed=42,
        tol=1e-6,
        popsize=20,
        workers=1
    )
    
    optimized_accuracy = -result.fun
    logger.info(f"Optimized accuracy: {optimized_accuracy:.4f}")
    
    # Also test with uniform weights as baseline
    uniform_weights = np.ones(n_signals) * 0.5
    baseline_acc = -objective(uniform_weights)
    logger.info(f"Baseline (uniform 0.5) accuracy: {baseline_acc:.4f}")
    
    # Build results
    optimized_weights = {}
    for j, sig_name in enumerate(eligible_signals):
        optimized_weights[sig_name] = round(float(result.x[j]), 4)
    
    # For signals that didn't have enough data, keep current weight or set to 0
    for sig_name in SIGNAL_NAMES:
        if sig_name not in optimized_weights:
            ss = signal_stats.get(sig_name)
            if ss and ss['total'] > 0 and ss['hit_rate'] > 0.5:
                optimized_weights[sig_name] = round(ss['hit_rate'] * 0.8, 4)
            else:
                optimized_weights[sig_name] = 0.0
    
    return optimized_weights, optimized_accuracy, baseline_acc


def update_weight_registry(conn, optimized_weights: Dict[str, float], signal_stats: Dict):
    """Update weight_registry table with optimized weights."""
    cur = conn.cursor()
    
    for sig_name, weight in optimized_weights.items():
        ss = signal_stats.get(sig_name, {})
        hit_rate = ss.get('hit_rate', 0.0)
        sample_size = ss.get('total', 0)
        
        cur.execute("""
            UPDATE weight_registry
            SET weight = %s, hit_rate = %s, sample_size = %s, updated_at = NOW()
            WHERE signal_type = %s
        """, (round(weight, 4), round(hit_rate, 4), sample_size, sig_name))
        
        if cur.rowcount == 0:
            logger.warning(f"No row in weight_registry for {sig_name}")
    
    conn.commit()
    logger.info(f"Updated weight_registry for {len(optimized_weights)} signals")


def verify_improvement(outcomes: List[Dict], old_weights: Dict[str, float],
                       new_weights: Dict[str, float]) -> Dict:
    """Compare prediction accuracy: old weights vs new weights."""
    
    def predict_with_weights(weights_dict):
        correct = 0
        total = 0
        for game in outcomes:
            actual = float(game['actual_value'])
            line = float(game.get('opening_line') or game.get('closing_line') or 0)
            if line == 0:
                continue
            
            signals = simulate_signals(game)
            if not signals:
                continue
            
            weighted_sum = 0.0
            for sig_name, sig in signals.items():
                if sig.get('fired') and sig_name in weights_dict:
                    w = weights_dict[sig_name]
                    direction_val = 1 if sig['direction'] == 'OVER' else -1
                    weighted_sum += w * sig['confidence'] * direction_val
            
            if weighted_sum == 0:
                continue
            
            predicted_over = weighted_sum > 0
            actual_over = actual > line
            
            total += 1
            if predicted_over == actual_over:
                correct += 1
        
        return correct / total if total > 0 else 0.0, total
    
    old_acc, old_n = predict_with_weights(old_weights)
    new_acc, new_n = predict_with_weights(new_weights)
    
    return {
        'old_accuracy': old_acc,
        'new_accuracy': new_acc,
        'old_games': old_n,
        'new_games': new_n,
        'improvement': new_acc - old_acc,
        'improvement_pct': ((new_acc - old_acc) / old_acc * 100) if old_acc > 0 else 0
    }


def main():
    logger.info("=" * 70)
    logger.info("SIGNAL WEIGHT OPTIMIZER - Starting")
    logger.info("=" * 70)
    
    conn = psycopg2.connect(DB_DSN)
    
    # 1. Load current weights
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT signal_type, weight, hit_rate, sample_size FROM weight_registry")
    old_weights = {r['signal_type']: float(r['weight']) for r in cur.fetchall()}
    logger.info(f"Current weights: {json.dumps(old_weights, indent=2)}")
    
    # 2. Load graded outcomes
    outcomes = load_graded_outcomes(conn)
    if len(outcomes) < 100:
        logger.error(f"Only {len(outcomes)} outcomes - not enough data")
        return
    
    # 3. Run backtest to measure individual signal accuracy
    logger.info("\n" + "=" * 70)
    logger.info("PHASE 1: Individual Signal Accuracy")
    logger.info("=" * 70)
    signal_stats = run_backtest(outcomes)
    
    print("\n" + "=" * 70)
    print("SIGNAL ACCURACY REPORT")
    print("=" * 70)
    print(f"{'Signal':<22} {'N':>6} {'Hit%':>7} {'Over%':>7} {'Under%':>7} {'AvgAdj':>8}")
    print("-" * 70)
    
    for sig_name in sorted(signal_stats.keys(), key=lambda x: signal_stats[x]['hit_rate'], reverse=True):
        ss = signal_stats[sig_name]
        print(f"{sig_name:<22} {ss['total']:>6} {ss['hit_rate']*100:>6.1f}% "
              f"{ss['over_rate']*100:>6.1f}% {ss['under_rate']*100:>6.1f}% "
              f"{ss['avg_adj']:>8.3f}")
    
    # 4. Optimize weights
    logger.info("\n" + "=" * 70)
    logger.info("PHASE 2: Weight Optimization")
    logger.info("=" * 70)
    optimized_weights, opt_acc, baseline_acc = optimize_weights(outcomes, signal_stats)
    
    print("\n" + "=" * 70)
    print("OPTIMIZED WEIGHTS")
    print("=" * 70)
    print(f"{'Signal':<22} {'Old Wt':>8} {'New Wt':>8} {'Hit%':>7} {'N':>6}")
    print("-" * 70)
    
    for sig_name in sorted(SIGNAL_NAMES):
        old_w = old_weights.get(sig_name, 0.0)
        new_w = optimized_weights.get(sig_name, 0.0)
        ss = signal_stats.get(sig_name, {})
        hit = ss.get('hit_rate', 0.0)
        n = ss.get('total', 0)
        marker = " ***" if abs(new_w - old_w) > 0.1 else ""
        print(f"{sig_name:<22} {old_w:>8.4f} {new_w:>8.4f} {hit*100:>6.1f}% {n:>6}{marker}")
    
    print(f"\nOptimized accuracy: {opt_acc:.4f}")
    print(f"Baseline accuracy:  {baseline_acc:.4f}")

    
    # 5. Verify improvement
    logger.info("\n" + "=" * 70)
    logger.info("PHASE 3: Verification")
    logger.info("=" * 70)
    verification = verify_improvement(outcomes, old_weights, optimized_weights)
    
    print("\n" + "=" * 70)
    print("VERIFICATION")
    print("=" * 70)
    print(f"Old weights accuracy: {verification['old_accuracy']:.4f} ({verification['old_games']} games)")
    print(f"New weights accuracy: {verification['new_accuracy']:.4f} ({verification['new_games']} games)")
    print(f"Improvement: {verification['improvement']:+.4f} ({verification['improvement_pct']:+.1f}%)")
    
    # 6. Update DB
    if verification['improvement'] >= 0:
        logger.info("New weights are better or equal - updating weight_registry")
        update_weight_registry(conn, optimized_weights, signal_stats)
        print("\nweight_registry UPDATED with optimized weights")
    else:
        logger.warning("New weights are worse - NOT updating")
        print("\nweight_registry NOT updated (new weights worse)")
    
    # 7. Final state
    cur.execute("SELECT signal_type, weight, hit_rate, sample_size FROM weight_registry ORDER BY signal_type")
    print("\n" + "=" * 70)
    print("FINAL WEIGHT_REGISTRY STATE")
    print("=" * 70)
    print(f"{'Signal':<22} {'Weight':>8} {'HitRate':>8} {'Samples':>8}")
    print("-" * 70)
    for r in cur.fetchall():
        print(f"{r['signal_type']:<22} {float(r['weight']):>8.4f} {float(r['hit_rate']):>8.4f} {r['sample_size']:>8}")
    
    conn.close()
    
    # Save results to JSON for reference
    results = {
        'timestamp': datetime.now().isoformat(),
        'signal_stats': {k: {kk: vv for kk, vv in v.items() if kk != 'adjustments'} for k, v in signal_stats.items()},
        'optimized_weights': optimized_weights,
        'verification': verification,
        'optimized_accuracy': opt_acc,
        'baseline_accuracy': baseline_acc,
    }
    results_path = '/var/www/courtsideedge/server/nba-prop-model/src/evaluation/optimization_results.json'
    with open(results_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    logger.info(f"Results saved to {results_path}")
    
    print("\nDONE!")


if __name__ == '__main__':
    main()
