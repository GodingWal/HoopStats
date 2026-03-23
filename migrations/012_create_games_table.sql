-- Migration 012: Create games table for referee/signal lookups
-- This table links game_id to teams and dates, enabling the backtest engine
-- to map (team, date) -> game_id for referee and other signal context lookups.

CREATE TABLE IF NOT EXISTS games (
    game_id VARCHAR(50) PRIMARY KEY,
    game_date DATE NOT NULL,
    home_team VARCHAR(10) NOT NULL,
    visitor_team VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_games_date ON games(game_date);
CREATE INDEX IF NOT EXISTS idx_games_home_team_date ON games(home_team, game_date);
CREATE INDEX IF NOT EXISTS idx_games_visitor_team_date ON games(visitor_team, game_date);
