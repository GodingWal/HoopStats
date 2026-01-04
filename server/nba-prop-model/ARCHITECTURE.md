# NBA Player Prop Betting Model - Architecture

## Philosophy

This model is built on several key insights that differentiate it from naive approaches:

1. **Minutes are everything** - The single biggest lever for counting stats. A sophisticated minutes model is worth more than fancy stat projections.

2. **Stats are correlated** - Points, assists, rebounds aren't independent. A player having a high-usage game affects all stats. We model them jointly.

3. **Uncertainty is information** - We don't just predict expected values; we model full distributions. A 25-point projection with high variance is very different from one with low variance.

4. **Market inefficiencies exist in edges, not means** - Books are good at setting means. Edge comes from understanding variance, correlation, and situational factors they underweight.

5. **Bayesian thinking prevents overreaction** - Small samples lie. We regress toward stable baselines.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  NBA API  │  PBPStats  │  Basketball Ref  │  Odds API  │  Injury Feeds     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FEATURE ENGINEERING                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Player Features  │  Team Features  │  Matchup Features  │  Situational     │
│  - Usage rates    │  - Pace         │  - Def ratings     │  - B2B status    │
│  - Per-minute     │  - Efficiency   │  - Position matchup│  - Rest days     │
│  - Trend/form     │  - Lineup data  │  - Style clash     │  - Home/away     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MODEL LAYER                                        │
├──────────────────┬──────────────────┬──────────────────┬────────────────────┤
│  MINUTES MODEL   │  OPPORTUNITY     │  EFFICIENCY      │  GAME SCRIPT      │
│                  │  MODEL           │  MODEL           │  MODEL            │
│  - Rotation pred │  - Usage redis-  │  - TS% vs matchup│  - Spread pred    │
│  - Blowout adj   │    tribution     │  - Assist rate   │  - Blowout prob   │
│  - Foul trouble  │  - Shot attempts │  - Rebound rate  │  - Pace expected  │
│    probability   │  - Touch share   │  - Turnover rate │  - Garbage time   │
└──────────────────┴──────────────────┴──────────────────┴────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      JOINT DISTRIBUTION MODEL                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  Multivariate output: (Points, Rebounds, Assists, 3PM, Steals, Blocks, TO)  │
│  - Copula for dependency structure                                          │
│  - Marginal distributions per stat (Normal, Poisson, NegBinom)              │
│  - Correlation matrix from historical data                                  │
│  - Monte Carlo simulation for combo props                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BETTING LAYER                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Line Comparison  │  Edge Calculation  │  Kelly Sizing  │  Portfolio Mgmt  │
│  - Multi-book     │  - P(over) vs impl │  - Fractional  │  - Correlation   │
│  - Best price     │  - Confidence int  │  - Bankroll %  │  - Max exposure  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Models - Detailed Design

### 1. Minutes Projection Model

**Why it matters**: A player's minutes explain 60-70% of the variance in their counting stats. Get this wrong, and everything else is noise.

**Inputs**:
- Season average minutes
- Recent minutes (last 5, 10 games)
- Team's rotation patterns
- Back-to-back status
- Opponent pace (faster pace → more total minutes for starters)
- Spread (blowout risk)
- Player's foul rate
- Injury report (teammate absences affect rotation)

**Model**: Bayesian regression with hierarchical priors

```
minutes_i ~ Normal(μ_i, σ_i)

μ_i = β_0 + β_season * season_avg 
        + β_recent * recent_avg 
        + β_b2b * is_back_to_back
        + β_spread * abs(spread)
        + β_pace * opp_pace_rank
        + teammate_injury_adjustments

σ_i = f(blowout_probability, foul_trouble_risk)
```

**Blowout Adjustment**:
- If |spread| > 10, increase variance significantly
- Model probability of garbage time minutes
- Starters lose ~4-8 minutes in blowouts

**Output**: Distribution over minutes, not point estimate

---

### 2. Usage Redistribution Model

**Why it matters**: When a key player is out, their usage/shots/assists don't disappear—they redistribute. This is where books are often slow.

**Approach**:
1. Build historical "when player X is out" dataset
2. Calculate redistribution coefficients per teammate
3. Apply Bayesian shrinkage (small samples are noisy)

```python
# Simplified logic
redistribution_matrix[player_out][teammate] = {
    'usage_boost': +2.5%,  # Teammate's usage increase
    'shots_boost': +3.2,   # Additional FGA
    'assist_boost': +1.1,  # Additional AST opportunities
}
```

**Key insight**: Not all usage redistributes equally. A point guard being out affects assist opportunities more than rebounds.

---

### 3. Matchup Adjustment Model

**Inputs**:
- Opponent's defensive rating (overall and positional)
- Opponent's pace
- Specific defender stats (if tracking data available)
- Historical player vs team performance (regressed)

**Adjustments calculated**:
```python
matchup_multipliers = {
    'points': opp_def_rating_factor * position_defense_factor,
    'rebounds': opp_reb_rate_allowed * pace_factor,
    'assists': opp_ast_allowed * pace_factor,
    '3pm': opp_3pt_defense * (volume_factor),
}
```

**Regression to mean**: Direct matchup history is noisy. Weight:
- 70% opponent's general defensive profile
- 20% positional matchup data
- 10% specific historical matchup (heavily regressed)

---

### 4. Game Script Model

**Purpose**: Predict expected game flow to adjust projections

**Outputs**:
- Expected pace
- Blowout probability (margin > 15 at any point)
- Garbage time probability
- Closing lineup probability

**Model**: 
- Spread → expected final margin distribution
- Historical blowout rates by spread
- Team-specific blowout tendencies

**Integration**:
```python
if blowout_prob > 0.3:
    minutes_projection *= (1 - blowout_prob * 0.15)  # Reduce expected minutes
    variance *= 1.3  # Increase uncertainty
```

---

### 5. Joint Distribution Model

**Why joint?**: Stats are correlated. High-usage games mean more points AND more assists (for playmakers) but potentially fewer rebounds (less transition).

**Approach**: Gaussian Copula with appropriate marginals

```python
# Marginal distributions
points ~ Normal(μ_pts, σ_pts)
rebounds ~ NegativeBinomial(r_reb, p_reb)
assists ~ Poisson(λ_ast)
threes ~ Poisson(λ_3pm)
steals ~ Poisson(λ_stl)
blocks ~ Poisson(λ_blk)

# Correlation structure (example)
Σ = [
    [1.00, 0.15, 0.35, 0.45, 0.10, 0.05],  # Points
    [0.15, 1.00, 0.10, 0.05, 0.15, 0.30],  # Rebounds
    [0.35, 0.10, 1.00, 0.20, 0.20, 0.05],  # Assists
    [0.45, 0.05, 0.20, 1.00, 0.05, 0.00],  # 3PM
    [0.10, 0.15, 0.20, 0.05, 1.00, 0.15],  # Steals
    [0.05, 0.30, 0.05, 0.00, 0.15, 1.00],  # Blocks
]
```

**Monte Carlo for combos**:
```python
def simulate_game(player, n_sims=10000):
    # Sample from joint distribution
    samples = copula.sample(n_sims)
    
    # Transform to marginals
    pts = norm.ppf(samples[:, 0], μ_pts, σ_pts)
    reb = nbinom.ppf(samples[:, 1], r_reb, p_reb)
    ast = poisson.ppf(samples[:, 2], λ_ast)
    # ... etc
    
    return DataFrame({'pts': pts, 'reb': reb, 'ast': ast, ...})

# For PrizePicks combos
def prob_all_overs(player, lines):
    sims = simulate_game(player)
    hits = (
        (sims['pts'] > lines['pts']) & 
        (sims['reb'] > lines['reb']) & 
        (sims['ast'] > lines['ast'])
    )
    return hits.mean()
```

---

## Feature Engineering Details

### Player Features

| Feature | Description | Update Frequency |
|---------|-------------|------------------|
| `usage_rate_season` | Season USG% | Daily |
| `usage_rate_l5` | Last 5 games USG% | Daily |
| `minutes_season` | Season avg minutes | Daily |
| `minutes_l5` | Last 5 avg minutes | Daily |
| `pts_per_min` | Points per minute played | Daily |
| `reb_per_min` | Rebounds per minute | Daily |
| `ast_per_min` | Assists per minute | Daily |
| `ts_pct` | True shooting % | Daily |
| `ftr` | Free throw rate | Daily |
| `tov_rate` | Turnover rate | Daily |
| `orb_pct` | Offensive rebound % | Daily |
| `drb_pct` | Defensive rebound % | Daily |
| `ast_pct` | Assist percentage | Daily |
| `stl_pct` | Steal percentage | Daily |
| `blk_pct` | Block percentage | Daily |
| `3par` | 3-point attempt rate | Daily |
| `career_baseline_*` | Career averages (regression target) | Weekly |

### Team Features

| Feature | Description |
|---------|-------------|
| `team_pace` | Possessions per 48 |
| `team_off_rating` | Points per 100 possessions |
| `team_def_rating` | Points allowed per 100 |
| `team_ast_rate` | Team assist percentage |
| `team_orb_rate` | Team offensive rebound rate |
| `team_3par` | Team 3-point attempt rate |

### Matchup Features

| Feature | Description |
|---------|-------------|
| `opp_def_rating` | Opponent defensive rating |
| `opp_pace` | Opponent pace |
| `opp_position_def` | Opponent defense vs position (1-5) |
| `opp_3pt_def` | Opponent 3PT% allowed |
| `opp_paint_def` | Opponent paint points allowed |
| `opp_ast_allowed` | Opponent assists allowed |
| `opp_reb_allowed` | Opponent rebounds allowed |

### Situational Features

| Feature | Description |
|---------|-------------|
| `is_home` | Home game indicator |
| `is_b2b` | Back-to-back indicator |
| `rest_days` | Days since last game |
| `travel_distance` | Miles traveled (fatigue proxy) |
| `altitude_change` | Altitude differential (Denver factor) |
| `timezone_change` | Timezone shifts |
| `days_since_injury` | Recovery timeline |
| `teammate_out_*` | Binary for key teammate absences |

---

## Evaluation Framework

### Backtesting Protocol

1. **Walk-forward validation**: Train on games before date D, test on date D, roll forward
2. **No lookahead bias**: Features computed only with data available before game time
3. **Track by stat type**: Some stats are more predictable than others

### Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| **Brier Score** | Calibration of P(over) predictions | < 0.24 |
| **Log Loss** | Probabilistic accuracy | < 0.68 |
| **ROI** | Return on investment at -110 | > 3% |
| **Hit Rate** | % of bets that win | > 52.4% |
| **CLV** | Closing line value captured | > 1% |
| **Sharpe Ratio** | Risk-adjusted returns | > 1.5 |

### Calibration Check

```python
# Group predictions by confidence bucket
# Verify: if we say 60% over, it should hit ~60%
buckets = pd.cut(predictions['prob_over'], bins=[0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 1.0])
calibration = actuals.groupby(buckets).mean()
```

---

## Data Pipeline

### Daily Update Schedule

```
6:00 AM ET - Pull previous night's box scores
6:30 AM ET - Update rolling features
7:00 AM ET - Pull injury reports
7:30 AM ET - Update matchup features
8:00 AM ET - Run projections for today's games
8:30 AM ET - Compare to opening lines
9:00 AM ET - Generate betting recommendations

Throughout day:
- Monitor line movements
- Update injury news
- Recalculate as needed
```

### Data Sources

| Source | Data | Update |
|--------|------|--------|
| `nba_api` | Box scores, play-by-play | Daily |
| `pbpstats.com` | Lineup data, on/off | Daily |
| `basketball-reference.com` | Historical, advanced stats | Daily |
| `odds-api.com` | Lines from multiple books | Real-time |
| `rotowire.com` | Injury reports | Real-time |

---

## File Structure

```
nba-prop-model/
├── config/
│   ├── settings.py          # API keys, parameters
│   └── features.yaml         # Feature definitions
├── src/
│   ├── data/
│   │   ├── nba_api_client.py    # NBA API wrapper
│   │   ├── odds_client.py       # Odds API wrapper
│   │   ├── injuries.py          # Injury scraping
│   │   └── db.py                # Database operations
│   ├── features/
│   │   ├── player_features.py   # Player feature engineering
│   │   ├── team_features.py     # Team features
│   │   ├── matchup_features.py  # Matchup calculations
│   │   └── situational.py       # B2B, rest, travel
│   ├── models/
│   │   ├── minutes_model.py     # Minutes projection
│   │   ├── usage_redistribution.py  # When players are out
│   │   ├── stat_projections.py  # Core stat models
│   │   ├── distributions.py     # Joint distribution/copula
│   │   └── ensemble.py          # Model combination
│   ├── evaluation/
│   │   ├── backtester.py        # Walk-forward testing
│   │   ├── metrics.py           # Brier, log loss, ROI
│   │   └── calibration.py       # Probability calibration
│   └── api/
│       ├── projections.py       # Generate projections
│       └── recommendations.py   # Betting recommendations
├── notebooks/
│   ├── 01_eda.ipynb            # Exploratory analysis
│   ├── 02_feature_importance.ipynb
│   └── 03_model_evaluation.ipynb
├── tests/
│   └── ...
└── main.py                      # Entry point
```

---

## Getting Started

1. **Set up environment**:
   ```bash
   pip install nba_api pandas numpy scipy scikit-learn pymc arviz requests
   ```

2. **Configure API keys** in `config/settings.py`

3. **Build historical database**:
   ```bash
   python src/data/build_historical.py --seasons 2022 2023 2024
   ```

4. **Run backtests**:
   ```bash
   python src/evaluation/backtester.py --start 2024-01-01 --end 2024-04-01
   ```

5. **Generate today's projections**:
   ```bash
   python main.py --date today
   ```

---

## Edge Cases & Gotchas

1. **Season start**: Limited data, rely more on career baselines
2. **Trades**: Player changes team mid-season, context shifts
3. **Load management**: Stars randomly sitting, hard to predict
4. **Playoff minutes**: Rotations tighten, starters play more
5. **Injury returns**: Minutes ramp-up period
6. **Garbage time**: High-variance stat accumulation
7. **Foul trouble**: Can't predict, but increases variance

---

## Future Enhancements

- [ ] Tracking data integration (Second Spectrum)
- [ ] Real-time line movement analysis
- [ ] Automated bet placement API
- [ ] Player tracking for hot/cold streaks
- [ ] Weather data for outdoor events (All-Star, etc.)
- [ ] Referee tendencies (foul calls, pace)
- [ ] Machine learning ensemble (XGBoost, neural nets)
