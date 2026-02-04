"""
Common stat type helpers shared across all signals.

Provides consistent stat key mapping and baseline calculation
for all supported stat types including STL, BLK, TO, and composites.
"""

from typing import Dict, Any, Optional


# Complete stat type to season_averages key mapping
STAT_KEY_MAP = {
    'Points': 'pts',
    'Rebounds': 'reb',
    'Assists': 'ast',
    '3-Pointers Made': 'fg3m',
    'Pts+Rebs+Asts': 'pra',
    'Steals': 'stl',
    'Blocks': 'blk',
    'Turnovers': 'tov',
    'Pts+Rebs': 'pr',
    'Pts+Asts': 'pa',
    'Rebs+Asts': 'ra',
}

# All stat types supported by the signal system
ALL_STAT_TYPES = [
    "Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts",
    "Steals", "Blocks", "Turnovers", "Pts+Rebs", "Pts+Asts", "Rebs+Asts",
]

# Composite stat definitions (components that make up each composite)
COMPOSITE_STATS = {
    'Pts+Rebs+Asts': ('pts', 'reb', 'ast'),
    'Pts+Rebs': ('pts', 'reb'),
    'Pts+Asts': ('pts', 'ast'),
    'Rebs+Asts': ('reb', 'ast'),
}

# Game log key alternatives (NBA API uses uppercase, some sources use lowercase)
GAME_LOG_KEY_MAP = {
    'pts': ['PTS', 'pts', 'points'],
    'reb': ['REB', 'reb', 'rebounds'],
    'ast': ['AST', 'ast', 'assists'],
    'fg3m': ['FG3M', 'fg3m', 'threes', '3pm'],
    'stl': ['STL', 'stl', 'steals'],
    'blk': ['BLK', 'blk', 'blocks'],
    'tov': ['TOV', 'tov', 'turnovers', 'TO'],
}


def get_stat_key(stat_type: str) -> Optional[str]:
    """Map stat type name to season_averages key."""
    return STAT_KEY_MAP.get(stat_type)


def get_baseline(stat_type: str, context: Dict[str, Any]) -> Optional[float]:
    """
    Get baseline value for a stat type from context season_averages.

    Handles direct lookups and composite stat calculations.
    """
    season_avgs = context.get('season_averages') or {}

    key = STAT_KEY_MAP.get(stat_type)
    if key and key in season_avgs:
        return season_avgs[key]

    # Handle composite stats by summing components
    if stat_type in COMPOSITE_STATS:
        components = COMPOSITE_STATS[stat_type]
        values = [season_avgs.get(k, 0) for k in components]
        total = sum(values)
        if total > 0:
            return total

    return None


def get_stat_value(
    averages: Dict[str, Any],
    stat_key: str,
    stat_type: str,
) -> Optional[float]:
    """
    Get stat value from an averages dict, handling composites.

    Works with season_averages, home_averages, away_averages, etc.
    """
    if stat_key in averages:
        return averages[stat_key]

    # Handle composite stats
    if stat_type in COMPOSITE_STATS:
        components = COMPOSITE_STATS[stat_type]
        values = [averages.get(k, 0) for k in components]
        total = sum(values)
        if total > 0:
            return total

    return None


def extract_game_stat(
    game: Dict[str, Any],
    stat_key: str,
    stat_type: str,
) -> Optional[float]:
    """
    Extract a stat value from a game log entry.

    Tries multiple key formats (uppercase, lowercase, full name).
    """
    keys = GAME_LOG_KEY_MAP.get(stat_key, [stat_key, stat_key.upper()])
    for k in keys:
        if k in game:
            try:
                return float(game[k])
            except (ValueError, TypeError):
                continue

    # Handle composite stats
    if stat_type in COMPOSITE_STATS:
        components = COMPOSITE_STATS[stat_type]
        values = []
        for comp_key in components:
            val = extract_game_stat(game, comp_key, comp_key)
            if val is None:
                return None
            values.append(val)
        return sum(values)

    return None
