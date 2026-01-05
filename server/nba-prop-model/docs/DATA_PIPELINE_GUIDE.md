# Real-Time Data Pipeline Guide

This guide outlines how to build a production-grade real-time data pipeline for the HoopStats projection system.

## Overview

The projection system needs several types of real-time data:

| Data Source | Information | Use Case | Update Frequency |
|-------------|-------------|----------|------------------|
| Rotowire / Rotogrinders | Injury reports, probable/doubtful/out | Usage redistribution | Every 30 min |
| ESPN API | Live lineups, starting confirmations | Minutes adjustments | 2 hours before tip |
| Odds API | Line movements, market consensus | Edge calculation | Every 5-10 min |
| NBA API Tracking | Shot contests, speed, distance | Advanced matchup data | Daily |
| Twitter / News | Late-breaking news | Manual adjustments | Real-time |

## 1. Injury Data Pipeline

### Data Sources

**Rotowire (Free Tier)**
```python
# server/nba-prop-model/src/data/injury_scraper.py
import requests
from bs4 import BeautifulSoup
import pandas as pd
from datetime import datetime

class InjuryReportScraper:
    """Scrape injury reports from Rotowire"""

    def __init__(self):
        self.url = "https://www.rotowire.com/basketball/nba-lineups.php"

    def fetch_injury_report(self) -> pd.DataFrame:
        """
        Fetch current injury report

        Returns DataFrame with columns:
        - player_name
        - team
        - status (OUT, DOUBTFUL, QUESTIONABLE, PROBABLE)
        - injury_type
        - last_updated
        """
        response = requests.get(self.url)
        soup = BeautifulSoup(response.content, 'html.parser')

        injuries = []

        # Parse injury report (structure varies by site)
        # Example logic:
        for player_row in soup.find_all('div', class_='lineup__player'):
            name = player_row.find('a', class_='lineup__player-name').text
            status = player_row.find('span', class_='lineup__injury-status').text
            team = player_row.find('span', class_='lineup__abbr').text

            injuries.append({
                'player_name': name.strip(),
                'team': team.strip(),
                'status': status.strip().upper(),
                'last_updated': datetime.now().isoformat()
            })

        return pd.DataFrame(injuries)

    def filter_relevant_injuries(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Filter for rotation players (>15 mpg) who are OUT or DOUBTFUL
        """
        # In production: join with player database to filter by mpg
        # For now: keep OUT and DOUBTFUL only
        return df[df['status'].isin(['OUT', 'DOUBTFUL'])]


# Usage:
scraper = InjuryReportScraper()
injuries = scraper.fetch_injury_report()
relevant_injuries = scraper.filter_relevant_injuries(injuries)
```

**NBA Injury API (Official)**
```python
from nba_api.stats.endpoints import LeagueGameLog
from datetime import datetime, timedelta

def get_inactive_players_last_n_days(n_days=7):
    """
    Get players who haven't played in last n days
    (likely injured or load managing)
    """
    end_date = datetime.now()
    start_date = end_date - timedelta(days=n_days)

    # Get all games in date range
    gamelog = LeagueGameLog(
        season='2024-25',
        season_type_all_star='Regular Season',
        date_from_nullable=start_date.strftime('%m/%d/%Y'),
        date_to_nullable=end_date.strftime('%m/%d/%Y')
    )

    df = gamelog.get_data_frames()[0]

    # Find players who appeared 0 times (inactive)
    all_players = get_all_rotation_players()  # From your DB
    active_players = set(df['PLAYER_NAME'].unique())
    inactive_players = all_players - active_players

    return list(inactive_players)
```

### Real-Time Integration

```python
# server/nba-prop-model/src/data/live_injury_monitor.py
import schedule
import time
from typing import Callable

class LiveInjuryMonitor:
    """Monitor injury reports and trigger projection updates"""

    def __init__(self, update_callback: Callable):
        self.scraper = InjuryReportScraper()
        self.update_callback = update_callback
        self.last_injuries = {}

    def check_for_updates(self):
        """Check if injury report has changed"""
        current = self.scraper.fetch_injury_report()
        relevant = self.scraper.filter_relevant_injuries(current)

        # Convert to dict for comparison
        current_dict = relevant.set_index('player_name')['status'].to_dict()

        # Find changes
        new_injuries = set(current_dict.keys()) - set(self.last_injuries.keys())
        status_changes = {
            player: current_dict[player]
            for player in current_dict
            if player in self.last_injuries and current_dict[player] != self.last_injuries[player]
        }

        if new_injuries or status_changes:
            print(f"Injury updates detected: {len(new_injuries)} new, {len(status_changes)} changed")
            self.update_callback(new_injuries, status_changes)

        self.last_injuries = current_dict

    def start_monitoring(self, interval_minutes=30):
        """Start monitoring loop"""
        schedule.every(interval_minutes).minutes.do(self.check_for_updates)

        print(f"Starting injury monitoring (every {interval_minutes} min)")
        while True:
            schedule.run_pending()
            time.sleep(60)


# Usage:
def on_injury_update(new_injuries, status_changes):
    """Callback when injuries change"""
    # Re-run projections for affected teams
    affected_teams = get_affected_teams(new_injuries, status_changes)
    for team in affected_teams:
        regenerate_team_projections(team)

monitor = LiveInjuryMonitor(on_injury_update)
monitor.start_monitoring(interval_minutes=30)
```

## 2. Lineup Confirmation Pipeline

### ESPN API

```python
# server/nba-prop-model/src/data/lineup_fetcher.py
import requests
from datetime import datetime

class LineupFetcher:
    """Fetch starting lineups from ESPN"""

    def __init__(self):
        self.base_url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"

    def get_todays_games(self):
        """Get all games scheduled for today"""
        url = f"{self.base_url}/scoreboard"
        response = requests.get(url)
        data = response.json()

        games = []
        for event in data.get('events', []):
            game_id = event['id']
            competitions = event.get('competitions', [])

            if competitions:
                comp = competitions[0]
                home_team = comp['competitors'][0]['team']['abbreviation']
                away_team = comp['competitors'][1]['team']['abbreviation']
                game_time = event['date']

                games.append({
                    'game_id': game_id,
                    'home_team': home_team,
                    'away_team': away_team,
                    'game_time': game_time,
                    'lineups_confirmed': False
                })

        return games

    def get_starting_lineup(self, game_id: str):
        """
        Fetch confirmed starting lineup for a game

        Returns dict: {team: [player1, player2, ...]}
        """
        url = f"{self.base_url}/summary"
        params = {'event': game_id}

        response = requests.get(url, params=params)
        data = response.json()

        lineups = {}

        # Parse lineup data (structure varies)
        for team_data in data.get('boxscore', {}).get('teams', []):
            team = team_data['team']['abbreviation']
            starters = []

            for player in team_data.get('statistics', [{}])[0].get('athletes', []):
                if player.get('starter', False):
                    starters.append(player['athlete']['displayName'])

            lineups[team] = starters

        return lineups

    def monitor_lineup_confirmations(self):
        """
        Monitor lineup confirmations 2 hours before games

        Trigger projection updates when starters confirmed
        """
        games = self.get_todays_games()

        for game in games:
            time_until_game = parse_time_until(game['game_time'])

            # Check lineups 2 hours before tip
            if 1.5 <= time_until_game <= 2.5 and not game['lineups_confirmed']:
                lineups = self.get_starting_lineup(game['game_id'])

                if lineups:
                    print(f"Lineups confirmed for {game['home_team']} vs {game['away_team']}")
                    update_projections_with_lineups(game, lineups)
                    game['lineups_confirmed'] = True
```

## 3. Odds Movement Pipeline

### The Odds API Integration

```python
# server/nba-prop-model/src/data/odds_tracker.py
import requests
from datetime import datetime
import pandas as pd

class OddsTracker:
    """Track odds movements for closing line value (CLV)"""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.base_url = "https://api.the-odds-api.com/v4"

    def get_current_odds(self, market='player_points'):
        """
        Fetch current player prop odds

        Markets: player_points, player_rebounds, player_assists, player_threes
        """
        url = f"{self.base_url}/sports/basketball_nba/odds"
        params = {
            'apiKey': self.api_key,
            'regions': 'us',
            'markets': market,
            'oddsFormat': 'american'
        }

        response = requests.get(url, params=params)
        data = response.json()

        odds = []

        for game in data:
            for bookmaker in game.get('bookmakers', []):
                for market_data in bookmaker.get('markets', []):
                    for outcome in market_data.get('outcomes', []):
                        odds.append({
                            'game_id': game['id'],
                            'bookmaker': bookmaker['key'],
                            'player': outcome['description'],
                            'line': outcome.get('point'),
                            'over_odds': outcome.get('price') if outcome['name'] == 'Over' else None,
                            'under_odds': outcome.get('price') if outcome['name'] == 'Under' else None,
                            'timestamp': datetime.now().isoformat()
                        })

        return pd.DataFrame(odds)

    def track_line_movements(self):
        """
        Track how lines move over time

        Store in database:
        - Opening line (first seen)
        - Current line
        - Line movements (history)

        Use for CLV (Closing Line Value) analysis
        """
        current_odds = self.get_current_odds()

        # Compare to stored odds
        # If line moved, log the movement
        for _, row in current_odds.iterrows():
            previous_line = get_previous_line_from_db(row['player'], row['game_id'])

            if previous_line and row['line'] != previous_line['line']:
                log_line_movement(
                    player=row['player'],
                    from_line=previous_line['line'],
                    to_line=row['line'],
                    timestamp=row['timestamp']
                )

        # Update database
        save_odds_to_db(current_odds)


# Scheduled monitoring
def monitor_odds():
    """Run every 5-10 minutes during betting hours"""
    tracker = OddsTracker(api_key=os.getenv('ODDS_API_KEY'))

    schedule.every(5).minutes.do(tracker.track_line_movements)

    while True:
        schedule.run_pending()
        time.sleep(60)
```

## 4. Historical Data Collection for Model Training

### Building Usage Redistribution Matrix

```python
# scripts/build_usage_redistribution_matrix.py
"""
Build historical usage redistribution patterns

Query: For each star player, find all games where they were OUT
Compare teammate stats in those games vs season averages
"""

from nba_api.stats.endpoints import PlayerGameLog, LeagueGameLog
import pandas as pd
import numpy as np

def build_redistribution_matrix(season='2024-25'):
    """
    Build usage redistribution matrix from historical data

    Output: DataFrame with columns:
    - team
    - injured_player
    - beneficiary
    - pts_boost
    - ast_boost
    - reb_boost
    - usg_boost
    - sample_size (games)
    """
    # Step 1: Get list of high-usage players (>20 USG%)
    high_usage_players = get_high_usage_players(season)

    results = []

    for player in high_usage_players:
        player_id = player['id']
        player_name = player['name']
        team = player['team']

        # Step 2: Get their team's game log
        team_games = LeagueGameLog(
            season=season,
            team_id_nullable=team
        ).get_data_frames()[0]

        # Step 3: Get player's game log
        player_games = PlayerGameLog(
            player_id=player_id,
            season=season
        ).get_data_frames()[0]

        # Step 4: Find games where player did NOT play
        player_game_ids = set(player_games['Game_ID'])
        all_game_ids = set(team_games['GAME_ID'])
        missed_game_ids = all_game_ids - player_game_ids

        if len(missed_game_ids) < 3:
            continue  # Not enough sample

        # Step 5: Get teammate stats in those games
        teammates_without = get_teammate_stats(team, missed_game_ids)
        teammates_with = get_teammate_stats(team, player_game_ids)

        # Step 6: Calculate boosts
        for teammate in teammates_without['PLAYER_NAME'].unique():
            without_stats = teammates_without[teammates_without['PLAYER_NAME'] == teammate]
            with_stats = teammates_with[teammates_with['PLAYER_NAME'] == teammate]

            if len(without_stats) >= 3 and len(with_stats) >= 5:
                pts_boost = without_stats['PTS'].mean() - with_stats['PTS'].mean()
                ast_boost = without_stats['AST'].mean() - with_stats['AST'].mean()
                reb_boost = without_stats['REB'].mean() - with_stats['REB'].mean()

                # Only record meaningful boosts (>1.5 pts)
                if pts_boost > 1.5:
                    results.append({
                        'team': team,
                        'injured_player': player_name,
                        'beneficiary': teammate,
                        'pts_boost': pts_boost,
                        'ast_boost': ast_boost,
                        'reb_boost': reb_boost,
                        'sample_size': len(without_stats)
                    })

    return pd.DataFrame(results)


# Run this script weekly to update redistribution matrix
if __name__ == '__main__':
    df = build_redistribution_matrix()
    df.to_csv('data/usage_redistribution_matrix.csv', index=False)
    print(f"Built redistribution matrix with {len(df)} patterns")
```

### Building Positional Defense Ratings

```python
# scripts/build_positional_defense_ratings.py
"""
Calculate which teams allow more/less production to specific positions
"""

def build_positional_defense_ratings(season='2024-25'):
    """
    For each team, calculate stats allowed by opponent position

    Output: DataFrame with:
    - team
    - position (G/F/C)
    - pts_vs_avg (e.g., 1.08 = allows 8% more than league avg)
    - ast_vs_avg
    - reb_vs_avg
    - threes_vs_avg
    - sample_size (games)
    """
    all_games = LeagueGameLog(season=season).get_data_frames()[0]

    results = []

    for team in all_games['TEAM_ABBREVIATION'].unique():
        # Get all games against this team
        opponent_games = all_games[all_games['MATCHUP'].str.contains(f'@ {team}|vs. {team}')]

        for position in ['G', 'F', 'C']:
            # Filter by position
            pos_games = opponent_games[opponent_games['POSITION'] == position]

            if len(pos_games) < 10:
                continue

            # Calculate averages
            pts_allowed = pos_games['PTS'].mean()
            ast_allowed = pos_games['AST'].mean()
            reb_allowed = pos_games['REB'].mean()
            threes_allowed = pos_games['FG3M'].mean()

            # Get league averages by position
            league_pts = all_games[all_games['POSITION'] == position]['PTS'].mean()
            league_ast = all_games[all_games['POSITION'] == position]['AST'].mean()
            league_reb = all_games[all_games['POSITION'] == position]['REB'].mean()
            league_threes = all_games[all_games['POSITION'] == position]['FG3M'].mean()

            # Calculate vs league average
            results.append({
                'team': team,
                'position': position,
                'pts_vs_avg': pts_allowed / league_pts if league_pts > 0 else 1.0,
                'ast_vs_avg': ast_allowed / league_ast if league_ast > 0 else 1.0,
                'reb_vs_avg': reb_allowed / league_reb if league_reb > 0 else 1.0,
                'threes_vs_avg': threes_allowed / league_threes if league_threes > 0 else 1.0,
                'sample_size': len(pos_games)
            })

    return pd.DataFrame(results)


if __name__ == '__main__':
    df = build_positional_defense_ratings()
    df.to_csv('data/positional_defense_ratings.csv', index=False)
    print(f"Built positional defense ratings for {len(df)} team-position combos")
```

## 5. Production Deployment

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Data Ingestion Layer                      │
├─────────────────────────────────────────────────────────────┤
│  Injury Monitor  │  Lineup Tracker  │  Odds Tracker         │
│  (every 30 min)  │  (2hr before)    │  (every 5 min)        │
└────────┬─────────────────┬───────────────────┬──────────────┘
         │                 │                   │
         v                 v                   v
┌─────────────────────────────────────────────────────────────┐
│                    Processing Layer                          │
├─────────────────────────────────────────────────────────────┤
│  Feature Engineering  │  Model Inference  │  Edge Calc      │
└────────┬──────────────────────┬───────────────────┬─────────┘
         │                      │                   │
         v                      v                   v
┌─────────────────────────────────────────────────────────────┐
│                    Output Layer                              │
├─────────────────────────────────────────────────────────────┤
│  Projection DB   │  Alert System   │  Dashboard             │
└─────────────────────────────────────────────────────────────┘
```

### Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  projection-engine:
    build: ./server/nba-prop-model
    environment:
      - ODDS_API_KEY=${ODDS_API_KEY}
      - NBA_API_ENABLED=true
    volumes:
      - ./data:/app/data
    depends_on:
      - postgres
      - redis

  injury-monitor:
    build: ./server/nba-prop-model
    command: python -m src.data.live_injury_monitor
    restart: always

  odds-tracker:
    build: ./server/nba-prop-model
    command: python -m src.data.odds_tracker
    restart: always

  postgres:
    image: postgres:14
    environment:
      - POSTGRES_DB=hoopstats
      - POSTGRES_USER=admin
      - POSTGRES_PASSWORD=${DB_PASSWORD}

  redis:
    image: redis:7
    # For caching projections
```

## 6. Testing the Pipeline

See `TESTING_GUIDE.md` for comprehensive testing examples.
