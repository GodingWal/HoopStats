"""
Schedule & Fatigue Context Features

Goes beyond binary B2B to model fatigue as a continuous, multi-factor
variable including timezone changes, altitude, travel distance,
and schedule density patterns.

Key features:
- Schedule density (3-in-4, 4-in-6, 5-in-7 flags)
- Travel burden (cross-country trips, timezone changes)
- Altitude adjustments (Denver/Utah effect)
- Rest advantage/disadvantage vs opponent
- Exponentially weighted fatigue accumulation
- Day-of-week patterns
"""

from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta
import numpy as np


class ScheduleContextEngineer:
    """
    Engineer schedule and fatigue context features.

    Models fatigue as a continuous, multi-dimensional variable
    rather than binary flags.
    """

    # Timezone offsets (hours from EST) for NBA cities
    TIMEZONE_MAP = {
        "BOS": 0, "NYK": 0, "BKN": 0, "PHI": 0, "TOR": 0,
        "CLE": 0, "DET": 0, "IND": 0, "WAS": 0, "ORL": 0,
        "MIA": 0, "ATL": 0, "CHA": 0,
        "CHI": -1, "MIL": -1, "MIN": -1, "MEM": -1, "NOP": -1,
        "DAL": -1, "HOU": -1, "SAS": -1, "OKC": -1,
        "DEN": -2, "UTA": -2, "PHX": -2,
        "LAL": -3, "LAC": -3, "GSW": -3, "SAC": -3, "POR": -3,
    }

    # Approximate distances between cities (miles) - key routes
    # Full matrix would be huge; we compute from coordinates
    CITY_COORDS = {
        "BOS": (42.36, -71.06), "NYK": (40.75, -73.99), "BKN": (40.68, -73.97),
        "PHI": (39.95, -75.17), "TOR": (43.64, -79.38), "CLE": (41.50, -81.69),
        "DET": (42.33, -83.05), "IND": (39.76, -86.16), "WAS": (38.90, -77.02),
        "ORL": (28.54, -81.38), "MIA": (25.78, -80.19), "ATL": (33.76, -84.39),
        "CHA": (35.23, -80.84), "CHI": (41.88, -87.63), "MIL": (43.04, -87.92),
        "MIN": (44.98, -93.28), "MEM": (35.14, -90.05), "NOP": (29.95, -90.08),
        "DAL": (32.79, -96.81), "HOU": (29.75, -95.36), "SAS": (29.43, -98.49),
        "OKC": (35.46, -97.52), "DEN": (39.75, -105.00), "UTA": (40.77, -111.90),
        "PHX": (33.45, -112.07), "LAL": (34.04, -118.27), "LAC": (34.04, -118.27),
        "GSW": (37.77, -122.39), "SAC": (38.58, -121.50), "POR": (45.53, -122.67),
    }

    # Arena altitudes (feet)
    ALTITUDE = {
        "DEN": 5280, "UTA": 4226, "OKC": 1201, "PHX": 1086,
        "ATL": 1050, "MIN": 830, "CHA": 751, "IND": 715,
        "SAS": 650, "CLE": 653, "MIL": 617, "CHI": 597,
        "DET": 600, "DAL": 430, "MEM": 337, "LAL": 340,
        "LAC": 340, "TOR": 249, "BOS": 141, "ORL": 82,
        "POR": 50, "HOU": 43, "PHI": 39, "NYK": 33,
        "BKN": 33, "SAC": 30, "GSW": 10, "MIA": 6,
        "NOP": 3, "WAS": 0,
    }

    def __init__(self):
        pass

    def compute_schedule_features(
        self,
        context: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Compute schedule and fatigue context features.

        Args:
            context: Dict with schedule info, game date, teams, etc.

        Returns:
            Dict of feature name -> value.
        """
        features = {}

        # Schedule density features
        features.update(self._schedule_density(context))

        # Rest days and B2B features
        features.update(self._rest_features(context))

        # Travel and timezone features
        features.update(self._travel_features(context))

        # Altitude features
        features.update(self._altitude_features(context))

        # Rest advantage vs opponent
        features.update(self._rest_advantage(context))

        # Cumulative fatigue score
        features.update(self._cumulative_fatigue(features, context))

        return features

    # ------------------------------------------------------------------
    # Schedule density
    # ------------------------------------------------------------------

    def _schedule_density(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Schedule density: games in N nights patterns."""
        features = {}

        game_date_str = ctx.get("game_date", "")
        recent_dates = ctx.get("recent_game_dates", [])

        if not game_date_str or not recent_dates:
            # Use pre-computed flags if available
            features["games_in_4_nights"] = float(ctx.get("games_in_4", 0))
            features["games_in_6_nights"] = float(ctx.get("games_in_6", 0))
            features["games_in_7_nights"] = float(ctx.get("games_in_7", 0))
            features["is_3_in_4"] = 1.0 if ctx.get("is_3_in_4", False) else 0.0
            features["is_4_in_6"] = 1.0 if ctx.get("is_4_in_6", False) else 0.0
            features["is_5_in_7"] = 1.0 if ctx.get("is_5_in_7", False) else 0.0
            return features

        try:
            current = datetime.strptime(str(game_date_str)[:10], "%Y-%m-%d")
        except (ValueError, TypeError):
            features["games_in_4_nights"] = 0.0
            features["games_in_6_nights"] = 0.0
            features["games_in_7_nights"] = 0.0
            features["is_3_in_4"] = 0.0
            features["is_4_in_6"] = 0.0
            features["is_5_in_7"] = 0.0
            return features

        # Parse recent game dates
        parsed_dates = []
        for d in recent_dates:
            try:
                if isinstance(d, datetime):
                    parsed_dates.append(d)
                elif isinstance(d, str):
                    parsed_dates.append(datetime.strptime(str(d)[:10], "%Y-%m-%d"))
            except (ValueError, TypeError):
                continue

        # Count games in windows
        games_in_4 = sum(1 for d in parsed_dates if 0 < (current - d).days <= 4)
        games_in_6 = sum(1 for d in parsed_dates if 0 < (current - d).days <= 6)
        games_in_7 = sum(1 for d in parsed_dates if 0 < (current - d).days <= 7)

        features["games_in_4_nights"] = float(games_in_4)
        features["games_in_6_nights"] = float(games_in_6)
        features["games_in_7_nights"] = float(games_in_7)
        features["is_3_in_4"] = 1.0 if games_in_4 >= 2 else 0.0  # This game + 2 = 3 in 4
        features["is_4_in_6"] = 1.0 if games_in_6 >= 3 else 0.0
        features["is_5_in_7"] = 1.0 if games_in_7 >= 4 else 0.0

        return features

    # ------------------------------------------------------------------
    # Rest features
    # ------------------------------------------------------------------

    def _rest_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Rest days and back-to-back features."""
        features = {}

        rest_days = ctx.get("rest_days", ctx.get("days_rest", 1))
        is_b2b = ctx.get("is_b2b", rest_days == 0)

        features["rest_days"] = float(rest_days)
        features["is_b2b"] = 1.0 if is_b2b else 0.0

        # Non-linear rest encoding
        # 0 days = heavy fatigue, 1 day = normal, 2 = well-rested, 3+ = rust risk
        if rest_days == 0:
            features["rest_impact"] = -0.08  # B2B penalty
        elif rest_days == 1:
            features["rest_impact"] = 0.0    # Normal
        elif rest_days == 2:
            features["rest_impact"] = 0.02   # Slightly rested
        elif rest_days <= 4:
            features["rest_impact"] = 0.01   # Rested but possible rust
        else:
            features["rest_impact"] = -0.01  # Extended absence, rust risk

        # Is this the 2nd night of B2B specifically?
        features["is_b2b_second_night"] = 1.0 if is_b2b else 0.0

        # Front end of B2B (playing tonight AND tomorrow)
        features["is_b2b_front"] = 1.0 if ctx.get("is_b2b_front", False) else 0.0

        return features

    # ------------------------------------------------------------------
    # Travel features
    # ------------------------------------------------------------------

    def _travel_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Travel distance and timezone change features."""
        features = {}

        home_team = ctx.get("player_team", "")
        game_location = ctx.get("game_location", ctx.get("opponent_team", ""))
        is_home = ctx.get("is_home", True)
        prev_game_location = ctx.get("prev_game_location", home_team)

        # Travel distance (from last game location to current)
        travel_miles = ctx.get("travel_distance", 0.0)
        if travel_miles == 0 and prev_game_location and game_location:
            travel_miles = self._compute_distance(prev_game_location, game_location)

        features["travel_distance_miles"] = travel_miles

        # Bucketed travel
        if travel_miles > 2000:
            features["travel_category"] = 3.0  # Cross-country
        elif travel_miles > 1000:
            features["travel_category"] = 2.0  # Long trip
        elif travel_miles > 500:
            features["travel_category"] = 1.0  # Medium trip
        else:
            features["travel_category"] = 0.0  # Short/home

        # Timezone change
        if is_home:
            tz_change = 0
        else:
            home_tz = self.TIMEZONE_MAP.get(home_team, 0)
            game_tz = self.TIMEZONE_MAP.get(game_location, 0)
            tz_change = abs(game_tz - home_tz)

        features["timezone_change"] = float(tz_change)
        features["is_west_to_east"] = 1.0 if ctx.get("travel_direction") == "east" else 0.0
        features["is_east_to_west"] = 1.0 if ctx.get("travel_direction") == "west" else 0.0

        # Cumulative travel in last 7 days
        features["cumulative_travel_7d"] = float(ctx.get("cumulative_travel_7d", travel_miles))

        return features

    # ------------------------------------------------------------------
    # Altitude features
    # ------------------------------------------------------------------

    def _altitude_features(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Altitude-based features (Denver/Utah effect)."""
        features = {}

        game_location = ctx.get("game_location", ctx.get("opponent_team", ""))
        home_team = ctx.get("player_team", "")
        is_home = ctx.get("is_home", True)

        # Current game altitude
        if is_home:
            game_alt = self.ALTITUDE.get(home_team, 0)
        else:
            game_alt = self.ALTITUDE.get(game_location, 0)

        home_alt = self.ALTITUDE.get(home_team, 0)
        altitude_change = abs(game_alt - home_alt)

        features["game_altitude"] = float(game_alt)
        features["altitude_change"] = float(altitude_change)
        features["is_high_altitude"] = 1.0 if game_alt >= 4000 else 0.0

        # Altitude fatigue factor
        if game_alt >= 5000:
            features["altitude_fatigue_factor"] = 0.04  # ~4% performance hit
        elif game_alt >= 4000:
            features["altitude_fatigue_factor"] = 0.02
        else:
            features["altitude_fatigue_factor"] = 0.0

        return features

    # ------------------------------------------------------------------
    # Rest advantage vs opponent
    # ------------------------------------------------------------------

    def _rest_advantage(self, ctx: Dict[str, Any]) -> Dict[str, float]:
        """Rest advantage/disadvantage vs opponent."""
        features = {}

        player_rest = ctx.get("rest_days", 1)
        opp_rest = ctx.get("opp_rest_days", 1)

        features["rest_advantage"] = float(player_rest - opp_rest)

        # Both teams on B2B
        features["both_b2b"] = 1.0 if player_rest == 0 and opp_rest == 0 else 0.0

        # Rested vs fatigued opponent (rest >= 2, opp B2B)
        features["rested_vs_tired"] = 1.0 if player_rest >= 2 and opp_rest == 0 else 0.0

        # Fatigued vs rested opponent
        features["tired_vs_rested"] = 1.0 if player_rest == 0 and opp_rest >= 2 else 0.0

        return features

    # ------------------------------------------------------------------
    # Cumulative fatigue score
    # ------------------------------------------------------------------

    def _cumulative_fatigue(
        self, existing_features: Dict[str, float], ctx: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Composite fatigue score combining all factors.
        0 = fully rested, 1+ = significant fatigue.
        """
        features = {}

        fatigue = 0.0

        # Schedule density contribution
        if existing_features.get("is_3_in_4", 0):
            fatigue += 0.25
        if existing_features.get("is_4_in_6", 0):
            fatigue += 0.30
        if existing_features.get("is_5_in_7", 0):
            fatigue += 0.35

        # B2B contribution
        if existing_features.get("is_b2b", 0):
            fatigue += 0.20

        # Travel contribution
        travel_cat = existing_features.get("travel_category", 0)
        fatigue += travel_cat * 0.05

        # Timezone change
        tz_change = existing_features.get("timezone_change", 0)
        fatigue += tz_change * 0.03

        # Altitude
        fatigue += existing_features.get("altitude_fatigue_factor", 0)

        # Minutes load (if available)
        minutes_7d = ctx.get("minutes_last_7_days", 0)
        if minutes_7d > 130:  # High minutes load
            fatigue += 0.10

        # Age multiplier
        age = ctx.get("player_age", 27)
        if age >= 33:
            fatigue *= 1.4
        elif age >= 30:
            fatigue *= 1.2
        elif age <= 23:
            fatigue *= 0.8

        features["cumulative_fatigue_score"] = float(np.clip(fatigue, 0, 2.0))

        # Fatigue impact on stats (estimated % reduction)
        features["fatigue_stat_impact"] = -fatigue * 0.03  # ~3% per fatigue unit

        return features

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _compute_distance(self, team1: str, team2: str) -> float:
        """Approximate great-circle distance between two NBA cities."""
        c1 = self.CITY_COORDS.get(team1)
        c2 = self.CITY_COORDS.get(team2)
        if not c1 or not c2:
            return 0.0

        # Haversine formula
        lat1, lon1 = np.radians(c1[0]), np.radians(c1[1])
        lat2, lon2 = np.radians(c2[0]), np.radians(c2[1])

        dlat = lat2 - lat1
        dlon = lon2 - lon1

        a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
        c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))

        return 3959 * c  # Earth radius in miles
