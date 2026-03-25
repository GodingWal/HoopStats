"""
Feature Engineering Module

Provides both basic and advanced feature engineering for NBA prop prediction.

Basic features (player_features, team_features, matchup_features, situational):
  - Season/rolling averages, per-minute rates, TS%, USG%
  - Team pace, offensive/defensive ratings
  - Position-specific defensive matchups
  - Situational B2B/home/rest adjustments

Advanced features (advanced/):
  - EWMA rolling features with exponential decay
  - Usage & efficiency derivatives with injury cascade
  - Defensive matchup scoring with scheme detection
  - Schedule/fatigue context (timezone, altitude, 3-in-4)
  - Shot quality estimation (qSQ) framework
  - Lineup rotation dynamics
  - Domain-specific interaction terms
  - PCA/NMF dimensionality reduction

XGBoost integration:
  - XGBoostFeatureBuilder (standard + advanced modes)
  - XGBOOST_FEATURE_NAMES (base feature set)
  - XGBOOST_FEATURE_NAMES_EXTENDED (base + advanced)
"""
