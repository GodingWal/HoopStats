-- Seed initial sportsbooks data
-- This script populates the sportsbooks table with major betting operators

BEGIN;

-- Insert major US sportsbooks
INSERT INTO sportsbooks (name, key, active) VALUES
  ('DraftKings', 'draftkings', true),
  ('FanDuel', 'fanduel', true),
  ('BetMGM', 'betmgm', true),
  ('Caesars', 'caesars', true),
  ('BetRivers', 'betrivers', true),
  ('PointsBet', 'pointsbet', true),
  ('Bet365', 'bet365', true),
  ('Unibet', 'unibet', true),
  ('WynnBET', 'wynnbet', true),
  ('Barstool', 'barstool', true),
  ('ESPNBet', 'espnbet', true),
  ('Fanatics', 'fanatics', true)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  active = EXCLUDED.active;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_sportsbooks_key ON sportsbooks(key);
CREATE INDEX IF NOT EXISTS idx_sportsbooks_active ON sportsbooks(active);

COMMIT;

-- Verify the insert
SELECT
  COUNT(*) as total_sportsbooks,
  COUNT(*) FILTER (WHERE active = true) as active_sportsbooks
FROM sportsbooks;
