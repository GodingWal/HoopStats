"""
Continuous Fatigue Model Signal

Expands beyond binary B2B to model fatigue as a continuous variable:
- 3 games in 4 nights, 4 in 6, etc.
- Minutes load over last 7/14 days
- Travel distance accumulation
- Altitude effects (Denver)
- Age-based fatigue multiplier

Context required:
    - recent_schedule: List[Dict] with dates and locations of recent games
    - avg_minutes: float
    - minutes_last_7: float (total minutes in last 7 days)
    - minutes_last_14: float (total minutes in last 14 days)
    - travel_distance: float (miles traveled recently, optional)
    - altitude_change: float (feet, optional)
    - player_age: int (optional)
    - is_b2b: bool (handled by B2B signal, we focus on OTHER fatigue)
"""

from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from .base import BaseSignal, SignalResult, registry


class FatigueSignal(BaseSignal):
    """
    Continuous fatigue model beyond simple B2B.

    Captures cumulative fatigue from:
    1. Schedule density (games per N days)
    2. Minutes accumulation (high-minute players regress more)
    3. Travel burden (West Coast road trips, timezone changes)
    4. Altitude effects (playing at elevation)
    5. Age-based recovery (older players fatigue faster)

    Note: B2B is handled by the separate B2B signal.
    This signal captures ADDITIONAL fatigue beyond B2B.
    """

    name = "fatigue"
    description = "Continuous fatigue model (schedule, travel, load)"
    stat_types = ["Points", "Rebounds", "Assists", "3-Pointers Made", "Pts+Rebs+Asts"]
    default_confidence = 0.55

    # Schedule density thresholds
    # 4 games in 6 nights is a significant load
    HEAVY_SCHEDULE_GAMES_6 = 4
    # 3 games in 4 nights (not just B2B)
    HEAVY_SCHEDULE_GAMES_4 = 3

    # Minutes load thresholds (for starters)
    HIGH_MINUTES_7_DAY = 120   # 120+ minutes in 7 days = high load
    HIGH_MINUTES_14_DAY = 220  # 220+ minutes in 14 days = high load
    NORMAL_MINUTES_7_DAY = 96  # ~32 min × 3 games
    NORMAL_MINUTES_14_DAY = 192  # ~32 min × 6 games

    # Travel thresholds (miles)
    HEAVY_TRAVEL = 5000     # 5000+ miles in recent stretch
    MODERATE_TRAVEL = 3000

    # Altitude cities (feet above sea level)
    HIGH_ALTITUDE_CITIES = {
        'DEN': 5280,  # Denver
        'UTA': 4226,  # Salt Lake City
        'PHX': 1086,  # Phoenix (moderate)
    }
    ALTITUDE_THRESHOLD = 4000  # Feet above sea level

    # Age fatigue multipliers
    AGE_FATIGUE_MULTIPLIER = {
        # Younger players recover faster
        range(18, 26): 0.8,
        range(26, 30): 1.0,
        range(30, 33): 1.2,
        range(33, 36): 1.4,
        range(36, 45): 1.6,
    }

    # Stat reduction per fatigue unit
    STAT_FATIGUE_SENSITIVITY = {
        'Points': -0.03,       # 3% per fatigue unit
        'Rebounds': -0.02,     # 2% (effort stat, but less affected)
        'Assists': -0.025,     # 2.5% (decision-making affected)
        '3-Pointers Made': -0.04,  # 4% (shooting most affected by fatigue)
        'Pts+Rebs+Asts': -0.025,
    }

    def calculate(
        self,
        player_id: str,
        game_date: str,
        stat_type: str,
        context: Dict[str, Any]
    ) -> SignalResult:
        """Calculate fatigue-based adjustment."""

        # Skip if this is just a B2B (handled by B2B signal)
        # We only fire for ADDITIONAL fatigue factors
        is_b2b = context.get('is_b2b', False)

        # Calculate fatigue score (0 = rested, 1+ = fatigued)
        fatigue_score = 0.0
        fatigue_factors = {}

        # 1. Schedule density
        schedule_fatigue = self._calculate_schedule_fatigue(game_date, context)
        if schedule_fatigue > 0:
            fatigue_score += schedule_fatigue
            fatigue_factors['schedule_density'] = schedule_fatigue

        # 2. Minutes load
        minutes_fatigue = self._calculate_minutes_fatigue(context)
        if minutes_fatigue > 0:
            fatigue_score += minutes_fatigue
            fatigue_factors['minutes_load'] = minutes_fatigue

        # 3. Travel burden
        travel_fatigue = self._calculate_travel_fatigue(context)
        if travel_fatigue > 0:
            fatigue_score += travel_fatigue
            fatigue_factors['travel'] = travel_fatigue

        # 4. Altitude
        altitude_fatigue = self._calculate_altitude_fatigue(context)
        if altitude_fatigue > 0:
            fatigue_score += altitude_fatigue
            fatigue_factors['altitude'] = altitude_fatigue

        # 5. Age multiplier
        age_mult = self._get_age_multiplier(context)
        fatigue_score *= age_mult

        # Don't double-count B2B (B2B signal handles that)
        # But if B2B + other factors, there's compounding
        if is_b2b and fatigue_score > 0:
            fatigue_score *= 0.7  # Reduce since B2B signal already fires

        # Only fire if meaningful fatigue detected
        if fatigue_score < 0.3:
            return self._create_neutral_result()

        # Calculate stat adjustment
        baseline = self._get_baseline(stat_type, context)
        if baseline is None or baseline <= 0:
            return self._create_neutral_result()

        sensitivity = self.STAT_FATIGUE_SENSITIVITY.get(stat_type, -0.025)
        adjustment = baseline * sensitivity * fatigue_score

        # Cap at reasonable limits
        adjustment = max(adjustment, -baseline * 0.15)  # Max 15% reduction

        confidence = min(0.50 + fatigue_score * 0.08, 0.68)

        return self._create_result(
            adjustment=adjustment,
            direction='UNDER',
            confidence=confidence,
            metadata={
                'fatigue_score': fatigue_score,
                'fatigue_factors': fatigue_factors,
                'age_multiplier': age_mult,
                'is_b2b': is_b2b,
                'baseline': baseline,
                'sensitivity': sensitivity,
            },
            sample_size=20,
        )

    def _calculate_schedule_fatigue(
        self,
        game_date: str,
        context: Dict[str, Any]
    ) -> float:
        """Calculate fatigue from schedule density."""

        recent_schedule = context.get('recent_schedule') or []
        team_schedule = context.get('team_schedule') or []

        # Use whichever schedule data is available
        game_dates = []
        for entry in recent_schedule:
            d = entry.get('date') or entry.get('GAME_DATE') or entry.get('game_date', '')
            if d:
                game_dates.append(d)

        if not game_dates and team_schedule:
            game_dates = team_schedule

        if not game_dates:
            return 0.0

        try:
            current_date = datetime.strptime(game_date, '%Y-%m-%d')
        except (ValueError, TypeError):
            return 0.0

        # Count games in last 4, 6, and 10 days
        games_in_4 = 0
        games_in_6 = 0
        games_in_10 = 0

        for gd in game_dates:
            try:
                if len(str(gd)) == 10 and str(gd)[4] == '-':
                    d = datetime.strptime(str(gd), '%Y-%m-%d')
                else:
                    d = datetime.strptime(str(gd), '%b %d, %Y')

                days_ago = (current_date - d).days
                if 0 < days_ago <= 4:
                    games_in_4 += 1
                if 0 < days_ago <= 6:
                    games_in_6 += 1
                if 0 < days_ago <= 10:
                    games_in_10 += 1
            except (ValueError, TypeError):
                continue

        fatigue = 0.0

        # 3 in 4 nights
        if games_in_4 >= self.HEAVY_SCHEDULE_GAMES_4:
            fatigue += 0.6

        # 4 in 6 nights
        if games_in_6 >= self.HEAVY_SCHEDULE_GAMES_6:
            fatigue += 0.5

        # 6+ in 10 nights
        if games_in_10 >= 6:
            fatigue += 0.4

        return fatigue

    def _calculate_minutes_fatigue(self, context: Dict[str, Any]) -> float:
        """Calculate fatigue from minutes accumulation."""
        minutes_7 = context.get('minutes_last_7', 0)
        minutes_14 = context.get('minutes_last_14', 0)

        fatigue = 0.0

        if minutes_7 > self.HIGH_MINUTES_7_DAY:
            excess = (minutes_7 - self.NORMAL_MINUTES_7_DAY) / self.NORMAL_MINUTES_7_DAY
            fatigue += min(excess * 0.5, 0.5)

        if minutes_14 > self.HIGH_MINUTES_14_DAY:
            excess = (minutes_14 - self.NORMAL_MINUTES_14_DAY) / self.NORMAL_MINUTES_14_DAY
            fatigue += min(excess * 0.3, 0.3)

        return fatigue

    def _calculate_travel_fatigue(self, context: Dict[str, Any]) -> float:
        """Calculate fatigue from travel distance."""
        travel_distance = context.get('travel_distance', 0)

        if travel_distance >= self.HEAVY_TRAVEL:
            return 0.4
        elif travel_distance >= self.MODERATE_TRAVEL:
            return 0.2
        return 0.0

    def _calculate_altitude_fatigue(self, context: Dict[str, Any]) -> float:
        """Calculate fatigue from altitude change."""
        altitude_change = context.get('altitude_change', 0)
        opponent_team = context.get('opponent_team', context.get('opponent', ''))

        # Check if playing at high altitude
        altitude = self.HIGH_ALTITUDE_CITIES.get(opponent_team, 0)
        if altitude_change > 0:
            altitude = altitude_change

        if altitude >= self.ALTITUDE_THRESHOLD:
            return 0.3
        return 0.0

    def _get_age_multiplier(self, context: Dict[str, Any]) -> float:
        """Get age-based fatigue multiplier."""
        age = context.get('player_age')
        if age is None:
            return 1.0

        for age_range, mult in self.AGE_FATIGUE_MULTIPLIER.items():
            if age in age_range:
                return mult

        return 1.0

    def _get_baseline(self, stat_type: str, context: Dict[str, Any]) -> Optional[float]:
        """Get baseline value for a stat type from context."""
        season_avgs = context.get('season_averages') or {}
        stat_key_map = {
            'Points': 'pts', 'Rebounds': 'reb', 'Assists': 'ast',
            '3-Pointers Made': 'fg3m', 'Pts+Rebs+Asts': 'pra',
        }
        key = stat_key_map.get(stat_type)
        if key and key in season_avgs:
            return season_avgs[key]
        if stat_type == 'Pts+Rebs+Asts':
            pts = season_avgs.get('pts', 0)
            reb = season_avgs.get('reb', 0)
            ast = season_avgs.get('ast', 0)
            if pts + reb + ast > 0:
                return pts + reb + ast
        return None


# Register signal with global registry
registry.register(FatigueSignal())
