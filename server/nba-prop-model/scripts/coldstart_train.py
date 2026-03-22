#!/usr/bin/env python3
"""
Cold-Start XGBoost Training

Builds training data from the sample-players.json file which contains
real NBA player stats: season/L5/L10 averages, hit rates at various lines,
recent game logs, home/away splits, and vs-team matchup history.

For each player × stat × line combination, we generate training rows using
the hit rates as ground truth labels and the averages/context as features.

For each player's recent games, we also create walk-forward training rows
where earlier games serve as context and later games as outcomes.

Usage:
    python scripts/coldstart_train.py
"""

import os
import sys
import json
import logging
import numpy as np
from typing import Dict, Any, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.models.xgboost_model import XGBoostPropModel, HAS_XGBOOST
from src.features.xgboost_features import XGBoostFeatureBuilder, XGBOOST_FEATURE_NAMES
from config.settings import XGBoostConfig

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

SAMPLE_DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'data', 'sample-players.json',
)

# Map stat type names to keys used in the sample data
STAT_MAP = {
    'Points':           {'avg_key': 'PTS', 'hit_key': 'PTS'},
    'Rebounds':         {'avg_key': 'REB', 'hit_key': 'REB'},
    'Assists':          {'avg_key': 'AST', 'hit_key': 'AST'},
    '3-Pointers Made':  {'avg_key': 'FG3M', 'hit_key': 'FG3M'},
    'Steals':           {'avg_key': 'STL', 'hit_key': 'STL'},
    'Blocks':           {'avg_key': 'BLK', 'hit_key': 'BLK'},
    'Turnovers':        {'avg_key': 'TOV', 'hit_key': 'TOV'},
}

# Feature builder stat_type -> key mapping
STAT_KEY_MAP = {
    'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
    '3-Pointers Made': 'fg3m', 'Steals': 'stl', 'Blocks': 'blk',
    'Turnovers': 'tov',
}


def load_sample_players() -> List[Dict]:
    """Load sample player data."""
    with open(SAMPLE_DATA_PATH) as f:
        return json.load(f)


def build_training_from_hit_rates(
    players: List[Dict],
    stat_type: str,
    avg_key: str,
    hit_key: str,
) -> List[Dict[str, Any]]:
    """
    Build training rows from hit rates.

    Each player has hit rates at different lines (e.g., PTS: {20.5: 100, 25.5: 95.2, ...}).
    We simulate many games per hit-rate entry, generating realistic feature contexts
    and sampling outcomes based on the actual hit rate.
    """
    feature_builder = XGBoostFeatureBuilder()
    stat_key = STAT_KEY_MAP[stat_type]
    rows = []
    rng = np.random.RandomState(42)

    for player in players:
        hit_rates = player.get('hit_rates', {}).get(hit_key, {})
        if not hit_rates:
            continue

        season_avg = player.get('season_averages', {})
        l10_avg = player.get('last_10_averages', {})
        l5_avg = player.get('last_5_averages', {})
        home_avg = player.get('home_averages', {})
        away_avg = player.get('away_averages', {})
        recent_games = player.get('recent_games', [])
        games_played = player.get('games_played', 40)

        season_stat = season_avg.get(avg_key, 0)
        l10_stat = l10_avg.get(avg_key, season_stat)
        l5_stat = l5_avg.get(avg_key, l10_stat)
        season_min = season_avg.get('MIN', 30)

        if season_stat == 0:
            continue

        # Compute volatility from recent games
        game_vals = [g.get(avg_key, 0) for g in recent_games if g.get('MIN', 0) > 5]
        game_mins = [g.get('MIN', 0) for g in recent_games if g.get('MIN', 0) > 5]
        stdev = float(np.std(game_vals, ddof=1)) if len(game_vals) > 1 else season_stat * 0.25
        cov = stdev / season_stat if season_stat > 0 else 0.3
        min_stdev = float(np.std(game_mins, ddof=1)) if len(game_mins) > 1 else 3.0
        min_floor = min(game_mins) if game_mins else season_min - 5
        iqr = float(np.percentile(game_vals, 75) - np.percentile(game_vals, 25)) if len(game_vals) >= 4 else stdev * 1.35

        for line_str, hit_pct in hit_rates.items():
            line = float(line_str)
            hit_rate = hit_pct / 100.0

            # Generate multiple samples per line to build volume
            n_samples = max(3, int(games_played * 0.4))

            for _ in range(n_samples):
                # Sample outcome based on actual hit rate
                target = int(rng.random() < hit_rate)

                # Simulate realistic actual value
                if target == 1:
                    # Over: sample from truncated normal above line
                    actual = line + abs(rng.normal(0, stdev * 0.8))
                else:
                    # Under: sample below line
                    actual = line - abs(rng.normal(0, stdev * 0.8))
                actual = max(0, actual)

                # Randomize situational context
                is_home = bool(rng.random() > 0.5)
                is_b2b = bool(rng.random() < 0.12)  # ~12% of games are B2B
                days_rest = 0 if is_b2b else int(rng.choice([1, 1, 1, 2, 2, 3]))

                context = {
                    'line': line,
                    'stat_type': stat_type,
                    'player_name': player.get('player_name', ''),
                    'is_home': is_home,
                    'is_b2b': is_b2b,
                    'days_rest': days_rest,
                    'season_averages': {stat_key: season_stat},
                    'last_5_averages': {stat_key: l5_stat + rng.normal(0, stdev * 0.2)},
                    'last_10_averages': {stat_key: l10_stat + rng.normal(0, stdev * 0.1)},
                    'home_averages': {stat_key: home_avg.get(avg_key, season_stat * 1.02)},
                    'away_averages': {stat_key: away_avg.get(avg_key, season_stat * 0.98)},
                    'game_logs': recent_games,
                    'projected_minutes': season_min + rng.normal(0, 1.5),
                    'projected_value': l10_stat,
                    'usage_rate': season_avg.get('FGA', 18) if avg_key == 'PTS' else 20.0,
                    'hit_rate': hit_rate,
                    'actual_value': actual,
                    # Volatility hints (supplement what feature builder extracts from game_logs)
                    'stdev_l10': stdev,
                    'coeff_of_variation': cov,
                    'iqr_last_10': iqr,
                }

                fv = feature_builder.build(context)
                rows.append({
                    'features': fv.features,
                    'target': target,
                })

    return rows


def build_training_from_game_logs(
    players: List[Dict],
    stat_type: str,
    avg_key: str,
) -> List[Dict[str, Any]]:
    """
    Build walk-forward training rows from recent game logs.

    For each player's game log, use earlier games as context features
    and the current game as the outcome. The line is set to the player's
    season average (realistic proxy for a sportsbook line).
    """
    feature_builder = XGBoostFeatureBuilder()
    stat_key = STAT_KEY_MAP[stat_type]
    rows = []

    for player in players:
        recent_games = player.get('recent_games', [])
        if len(recent_games) < 3:
            continue

        season_avg = player.get('season_averages', {})
        l10_avg = player.get('last_10_averages', {})
        home_avg = player.get('home_averages', {})
        away_avg = player.get('away_averages', {})
        season_stat = season_avg.get(avg_key, 0)
        season_min = season_avg.get('MIN', 30)

        if season_stat == 0:
            continue

        # Use season average as the "line" (realistic proxy)
        line = round(season_stat - 0.5) + 0.5  # Round to nearest .5

        # Walk forward through games
        games_chrono = list(reversed(recent_games))

        for i in range(2, len(games_chrono)):
            current = games_chrono[i]
            actual = current.get(avg_key, 0)
            actual_min = current.get('MIN', 0)
            if actual_min < 5:
                continue

            prev_games = games_chrono[:i]
            target = int(actual > line)

            context = {
                'line': line,
                'stat_type': stat_type,
                'player_name': player.get('player_name', ''),
                'is_home': '@' not in current.get('OPPONENT', ''),
                'is_b2b': False,
                'days_rest': 1,
                'season_averages': {stat_key: season_stat},
                'last_5_averages': {stat_key: l10_avg.get(avg_key, season_stat)},
                'last_10_averages': {stat_key: season_stat},
                'home_averages': {stat_key: home_avg.get(avg_key, season_stat)},
                'away_averages': {stat_key: away_avg.get(avg_key, season_stat)},
                'game_logs': prev_games,
                'projected_minutes': season_min,
                'projected_value': season_stat,
                'hit_rate': 0.5,
                'actual_value': actual,
            }

            fv = feature_builder.build(context)
            rows.append({
                'features': fv.features,
                'target': target,
            })

    return rows


def build_training_from_matchups(
    players: List[Dict],
    stat_type: str,
    avg_key: str,
) -> List[Dict[str, Any]]:
    """
    Build training rows from vs_team matchup data.

    Uses the player's average vs. specific teams as outcomes,
    with the season average line as the betting line.
    """
    feature_builder = XGBoostFeatureBuilder()
    stat_key = STAT_KEY_MAP[stat_type]
    rows = []
    rng = np.random.RandomState(123)

    for player in players:
        vs_team = player.get('vs_team', {})
        if not vs_team:
            continue

        season_avg = player.get('season_averages', {})
        l10_avg = player.get('last_10_averages', {})
        home_avg = player.get('home_averages', {})
        away_avg = player.get('away_averages', {})
        recent_games = player.get('recent_games', [])
        season_stat = season_avg.get(avg_key, 0)
        season_min = season_avg.get('MIN', 30)

        if season_stat == 0:
            continue

        line = round(season_stat - 0.5) + 0.5

        for opp_team, matchup_stats in vs_team.items():
            vs_avg = matchup_stats.get(avg_key, 0)
            n_games = matchup_stats.get('games', 1)

            if vs_avg == 0:
                continue

            # Generate samples proportional to games played
            for _ in range(n_games):
                # Actual value ~ matchup average with some noise
                stdev = season_stat * 0.2
                actual = vs_avg + rng.normal(0, stdev)
                actual = max(0, actual)
                target = int(actual > line)

                context = {
                    'line': line,
                    'stat_type': stat_type,
                    'player_name': player.get('player_name', ''),
                    'opponent': opp_team,
                    'is_home': bool(rng.random() > 0.5),
                    'is_b2b': False,
                    'days_rest': 1,
                    'season_averages': {stat_key: season_stat},
                    'last_5_averages': {stat_key: l10_avg.get(avg_key, season_stat)},
                    'last_10_averages': {stat_key: season_stat},
                    'home_averages': {stat_key: home_avg.get(avg_key, season_stat)},
                    'away_averages': {stat_key: away_avg.get(avg_key, season_stat)},
                    'game_logs': recent_games,
                    'player_vs_opp_hist_avg': vs_avg,
                    'projected_minutes': season_min,
                    'projected_value': vs_avg,
                    'hit_rate': 0.5,
                    'actual_value': actual,
                }

                fv = feature_builder.build(context)
                rows.append({
                    'features': fv.features,
                    'target': target,
                })

    return rows


def run_coldstart_training():
    """Main cold-start training pipeline."""
    config = XGBoostConfig()
    model_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        config.model_dir,
    )
    os.makedirs(model_dir, exist_ok=True)

    logger.info("=" * 60)
    logger.info("XGBOOST COLD-START TRAINING")
    logger.info(f"Native XGBoost: {HAS_XGBOOST}")
    logger.info(f"Model output:   {model_dir}")
    logger.info(f"Data source:    {SAMPLE_DATA_PATH}")
    logger.info("=" * 60)

    # Load sample data
    players = load_sample_players()
    logger.info(f"Loaded {len(players)} players from sample data")

    # Initialize model
    model = XGBoostPropModel(
        n_estimators=config.n_estimators,
        max_depth=config.max_depth,
        learning_rate=config.learning_rate,
        min_child_weight=config.min_child_weight,
        subsample=config.subsample,
        colsample_bytree=config.colsample_bytree,
        reg_alpha=config.reg_alpha,
        reg_lambda=config.reg_lambda,
        model_dir=model_dir,
    )

    results = {}

    for stat_type, info in STAT_MAP.items():
        avg_key = info['avg_key']
        hit_key = info['hit_key']

        logger.info(f"\n{'='*50}")
        logger.info(f"BUILDING DATA: {stat_type}")
        logger.info(f"{'='*50}")

        # Combine all data sources
        rows_hr = build_training_from_hit_rates(players, stat_type, avg_key, hit_key)
        rows_gl = build_training_from_game_logs(players, stat_type, avg_key)
        rows_mu = build_training_from_matchups(players, stat_type, avg_key)

        all_rows = rows_hr + rows_gl + rows_mu

        logger.info(f"  Hit-rate rows:  {len(rows_hr)}")
        logger.info(f"  Game-log rows:  {len(rows_gl)}")
        logger.info(f"  Matchup rows:   {len(rows_mu)}")
        logger.info(f"  Total:          {len(all_rows)}")

        if len(all_rows) < 30:
            logger.warning(f"  Skipping {stat_type}: insufficient data")
            results[stat_type] = {'status': 'skipped', 'n_samples': len(all_rows)}
            continue

        # Shuffle to mix data sources (but train/val split is still last 20%)
        rng = np.random.RandomState(42)
        indices = list(range(len(all_rows)))
        rng.shuffle(indices)
        all_rows = [all_rows[i] for i in indices]

        hit_rate = np.mean([r['target'] for r in all_rows])
        logger.info(f"  Overall hit rate: {hit_rate:.3f}")

        # Train
        logger.info(f"\n  TRAINING {stat_type}...")
        metrics = model.train(all_rows, stat_type, validation_split=config.validation_split)

        if 'error' in metrics:
            logger.error(f"  FAILED: {metrics['error']}")
            results[stat_type] = metrics
            continue

        model.save(stat_type)
        metrics['status'] = 'trained'
        results[stat_type] = metrics

        logger.info(f"  val_accuracy:  {metrics.get('val_accuracy', 0):.4f}")
        logger.info(f"  val_logloss:   {metrics.get('val_logloss', 0):.4f}")
        logger.info(f"  model_type:    {metrics.get('model_type', '?')}")
        logger.info(f"  train/val:     {metrics.get('n_train', 0)} / {metrics.get('n_val', 0)}")

        top = metrics.get('top_features', [])[:7]
        if top:
            logger.info(f"  Top features:")
            for fname, imp in top:
                logger.info(f"    {fname:30s} {imp:.4f}")

    # Summary
    logger.info(f"\n{'='*60}")
    logger.info("TRAINING COMPLETE")
    logger.info(f"{'='*60}")

    trained = sum(1 for r in results.values() if r.get('status') == 'trained')
    logger.info(f"Models trained: {trained}/{len(STAT_MAP)}")
    logger.info(f"Saved to: {model_dir}/\n")

    for stat_type, m in results.items():
        if m.get('status') == 'trained':
            logger.info(
                f"  {stat_type:20s}  acc={m.get('val_accuracy',0):.4f}  "
                f"logloss={m.get('val_logloss',0):.4f}  "
                f"n={m.get('n_train',0)+m.get('n_val',0)}"
            )

    # Verify models load and predict
    logger.info("\nVerifying saved models...")
    verify = XGBoostPropModel(model_dir=model_dir)
    for stat_type in results:
        if results[stat_type].get('status') == 'trained':
            loaded = verify.load(stat_type)
            if loaded:
                pred = verify.predict(
                    {'line': 20.5, 'stat_type': stat_type,
                     'season_averages': {'pts': 22, 'reb': 7, 'ast': 5, 'fg3m': 2.5, 'stl': 1.2, 'blk': 0.8, 'tov': 2.5},
                     'last_10_averages': {'pts': 23, 'reb': 7.5, 'ast': 5.2, 'fg3m': 2.8, 'stl': 1.0, 'blk': 0.7, 'tov': 2.3},
                     'last_5_averages': {'pts': 24, 'reb': 8, 'ast': 4.8, 'fg3m': 3.0, 'stl': 1.3, 'blk': 0.9, 'tov': 2.1}},
                    stat_type,
                )
                logger.info(f"  {stat_type:20s}  load=OK  P(over)={pred.prob_over:.3f}  conf={pred.confidence:.3f}")
            else:
                logger.error(f"  {stat_type:20s}  load=FAILED")

    return results


if __name__ == '__main__':
    results = run_coldstart_training()
    print("\n" + json.dumps(results, indent=2, default=str))
