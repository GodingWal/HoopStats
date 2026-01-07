-- Migration: Add edge tracking fields to potential bets

ALTER TABLE potential_bets
ADD COLUMN IF NOT EXISTS edge_type TEXT,
ADD COLUMN IF NOT EXISTS edge_score REAL,
ADD COLUMN IF NOT EXISTS edge_description TEXT;

-- Index for querying by edge score
CREATE INDEX IF NOT EXISTS idx_potential_bets_edge_score ON potential_bets(edge_score DESC);
