import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

MIGRATION_CONTENT = """-- Migration: Create Referee Tracking Tables
-- Description: Stores referee information and game assignments for foul tracking

-- ============================================================================
-- TABLE 1: referees
-- Stores individual referee details
-- ============================================================================
CREATE TABLE IF NOT EXISTS referees (
    id INTEGER PRIMARY KEY,  -- Using official NBA ID from stats
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    jersey_number TEXT,
    
    -- Foul stats (updated periodically)
    avg_fouls_per_game REAL,
    games_officiated INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- TABLE 2: game_referees
-- Links referees to specific games
-- ============================================================================
CREATE TABLE IF NOT EXISTS game_referees (
    id SERIAL PRIMARY KEY,
    game_id VARCHAR(50) NOT NULL,
    referee_id INTEGER REFERENCES referees(id),
    game_date DATE NOT NULL,
    
    -- Unique constraint: A ref can't be assigned to the same game twice
    UNIQUE(game_id, referee_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_game_referees_game_id ON game_referees(game_id);
CREATE INDEX IF NOT EXISTS idx_game_referees_referee_id ON game_referees(referee_id);
CREATE INDEX IF NOT EXISTS idx_game_referees_date ON game_referees(game_date);

-- Comments
COMMENT ON TABLE referees IS 'NBA officials with optional foul stats';
COMMENT ON TABLE game_referees IS 'Mapping of officials to games';
"""

def run_command(client, command, timeout=60):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("RUNNING REFEREE MIGRATION")
    print("="*60)
    
    # Write migration file
    print("\n[1] Uploading migration file...")
    run_command(client, f"cat > /var/www/hoopstats/migrations/008_referee_tracking.sql << 'EOF'\n{MIGRATION_CONTENT}\nEOF")
    
    # Run migration
    print("\n[2] Running migration 008_referee_tracking.sql...")
    run_command(client, "sudo -u postgres psql -d hoopstats -f /var/www/hoopstats/migrations/008_referee_tracking.sql")
    
    # Grant permissions
    print("\n[3] Granting permissions to hoopstats_user...")
    run_command(client, """sudo -u postgres psql -d hoopstats -c "GRANT ALL PRIVILEGES ON TABLE referees TO hoopstats_user;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "GRANT ALL PRIVILEGES ON TABLE game_referees TO hoopstats_user;" """)
    run_command(client, """sudo -u postgres psql -d hoopstats -c "GRANT ALL PRIVILEGES ON SEQUENCE game_referees_id_seq TO hoopstats_user;" """)

    # Verify
    print("\n[4] Verifying tables...")
    run_command(client, r"sudo -u postgres psql -d hoopstats -c \"\\dt *referee*\"")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
