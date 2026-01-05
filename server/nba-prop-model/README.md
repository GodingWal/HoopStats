# NBA Player Prop Betting Model

A comprehensive, probabilistic model for NBA player prop betting that focuses on proper uncertainty quantification and correlation-aware projections.

## Key Differentiators

1. **Distribution-Based Projections** - Not just point estimates. Full probability distributions for each stat with appropriate distribution families (Normal for points, Poisson/NegBinom for count stats).

2. **Correlation-Aware** - Joint modeling of stats using Gaussian copulas. A player having a high-scoring game affects their other stats. Essential for combo props.

3. **Minutes-First Philosophy** - Most models predict stats directly. We predict minutes first, then stats per minute. Minutes are the biggest lever.

4. **Bayesian Regression** - Small samples lie. We regress toward stable baselines (career averages, league norms) and increase trust as sample size grows.

5. **Proper Backtesting** - Walk-forward validation, no lookahead bias, calibration checks.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run demo
python main.py --demo

# Project specific players
python main.py --players "LeBron James" "Stephen Curry"
```

## Project Structure

```
nba-prop-model/
├── ARCHITECTURE.md          # Detailed system design
├── main.py                  # Entry point
├── requirements.txt
├── config/
│   └── settings.py          # Configuration
├── src/
│   ├── data/
│   │   └── nba_api_client.py    # NBA API wrapper
│   ├── features/
│   │   └── player_features.py   # Feature engineering
│   ├── models/
│   │   ├── distributions.py     # Probability distributions
│   │   └── projection_engine.py # Main projection logic
│   └── evaluation/
│       └── backtester.py        # Backtesting framework
```

## Model Components

### 1. Minutes Projection
- Weighted average of season/recent minutes
- Situational adjustments (B2B, rest days, home/away)
- Blowout risk modeling (high spread = higher variance)
- Teammate injury redistribution

### 2. Per-Stat Projections
Each stat has its own model considering:
- Per-minute production rates
- Matchup adjustments (opponent defense)
- Trend/form analysis
- Regression toward stable baselines

### 3. Distribution Fitting
- **Points**: Normal distribution
- **Rebounds**: Negative binomial (overdispersed counts)
- **Assists, 3PM, Steals, Blocks**: Poisson or NegBinom based on overdispersion test

### 4. Joint Distribution
Stats are correlated. We use a Gaussian copula to model dependencies:
- PTS-AST correlation: ~0.35 (playmakers)
- REB-BLK correlation: ~0.30 (bigs)
- PTS-3PM correlation: ~0.45 (shooters)

### 5. Betting Layer
- Edge calculation: model_prob - implied_prob
- Kelly criterion sizing with fraction (default 0.25)
- Minimum edge threshold (default 3%)

## Usage Examples

### Generate Player Projections

```python
from src.data.nba_api_client import NBADataClient
from src.models.projection_engine import ProjectionEngine, create_sample_context

client = NBADataClient()
engine = ProjectionEngine()

# Get player data
player_id = client.get_player_id("Luka Doncic")
game_log = client.get_player_game_log(player_id)
career_stats = client.get_player_career_stats(player_id)

# Create game context
context = create_sample_context(opponent="BOS", is_home=True)

# Generate projection
projection = engine.project_player(game_log, context, career_stats)

print(f"Points: {projection.points.mean:.1f} ± {projection.points.std:.1f}")
print(f"P(over 30.5 pts): {projection.points.prob_over(30.5):.1%}")
```

### Evaluate a Prop Bet

```python
# Evaluate points over 30.5 at -110
rec = engine.evaluate_prop(projection, "points", 30.5, odds=-110)

print(f"Side: {rec.side}")
print(f"Model Prob: {rec.model_prob:.1%}")
print(f"Edge: {rec.edge:.1%}")
print(f"Kelly Bet: {rec.kelly_bet:.2%} of bankroll")
```

### Evaluate a Parlay

```python
# Evaluate PTS/REB/AST all overs
legs = [
    ('points', 30.5, 'over'),
    ('rebounds', 8.5, 'over'),
    ('assists', 7.5, 'over'),
]

result = engine.evaluate_parlay(projection, legs)
print(f"Parlay probability: {result['probability']:.1%}")
print(f"Fair odds: {result['fair_odds']:+d}")
```

### Run Backtest

```python
from src.evaluation.backtester import Backtester

backtester = Backtester(min_edge_threshold=0.03)
results = backtester.run_backtest(predictions_df, actuals_df)

print(results.summary())
```

## Configuration

Key settings in `config/settings.py`:

```python
# Model parameters
min_edge_threshold = 0.03      # 3% edge minimum
kelly_fraction = 0.25          # Quarter Kelly
n_simulations = 10000          # Monte Carlo sims

# Feature engineering
rolling_windows = [3, 5, 10, 20]
regression_games = 20          # Games before trusting sample
```

## Data Sources

- **NBA API** (nba_api package) - Official NBA stats
- **Odds API** - Lines from multiple books (requires API key)
- **PBPStats** - Lineup and on/off data
- **Basketball Reference** - Historical data

## Recent Improvements ✨

### Enhanced Minutes Model (Highest Leverage!)
- ✅ Back-to-back impact: -4.5 minutes
- ✅ Rest days adjustment: +2.0 for 3+ days rest
- ✅ Blowout risk modeling: -8.0 minutes (from spread + total)
- ✅ Foul trouble patterns: -2.0 for high-foul players
- ✅ Teammate injury redistribution: +0.15 × missing minutes

### Usage Redistribution (YOUR EDGE!)
- ✅ Historical "Player X OUT" analysis
- ✅ Team-specific redistribution matrices
- ✅ Example: When Giannis OUT → Dame +6.6 pts, +1.8 ast
- ✅ Handles multiple simultaneous injuries
- ✅ Generic fallback for missing data

### Positional Defense Matchups
- ✅ Position-specific defensive ratings
- ✅ Example: WAS allows +10% to guards, PHX allows +8% to centers
- ✅ Find favorable matchups automatically
- ✅ Nonlinear scaling for elite/bad defenses

### Advanced Features
- ✅ Correlation-aware parlay evaluation
- ✅ Kelly criterion bet sizing
- ✅ Comprehensive backtesting with calibration
- ✅ Distribution modeling (Normal, Poisson, NegBinom)

See [docs/DATA_PIPELINE_GUIDE.md](docs/DATA_PIPELINE_GUIDE.md) and [examples/comprehensive_projection_example.py](examples/comprehensive_projection_example.py) for details.

## Roadmap

- [x] Enhanced minutes model with contextual adjustments
- [x] Usage redistribution from historical analysis
- [x] Positional defense matchups
- [ ] Real-time odds integration (docs available)
- [ ] Real-time injury monitoring (docs available)
- [ ] Lineup confirmation pipeline (docs available)
- [ ] Automated bet placement
- [ ] Tracking data integration
- [ ] ML ensemble models
- [ ] Web dashboard

## License

MIT License

## Disclaimer

This is for educational purposes. Gambling involves risk. Bet responsibly.
