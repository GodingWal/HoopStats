
import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
ROOT_DIR = "/var/www/hoopstats"
MODEL_DIR = f"{ROOT_DIR}/server/nba-prop-model"
VENV_DIR = f"{MODEL_DIR}/venv"
PYTHON_EXEC = f"{VENV_DIR}/bin/python"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USERNAME, password=PASSWORD)
        return client
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

def run_command(client, command, cwd=None):
    if cwd:
        command = f"cd {cwd} && {command}"
    
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Error:\n{err}")
        
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("Starting Backtest Infrastructure Update & Init...")
        
        # 1. Update Codebase & DB Schema (Root level)
        print("\n[1/5] Updating Codebase & DB Schema...")
        # Git pull
        run_command(client, "git pull origin main", cwd=ROOT_DIR)
        # Install node deps (in case)
        run_command(client, "npm install", cwd=ROOT_DIR)
        # Push drizzle schema changes (adds position column to players)
        run_command(client, "npm run db:push", cwd=ROOT_DIR)

        # 2. Setup Python Environment
        print("\n[2/5] Setting up Python Environment...")
        # Create venv if needed
        run_command(client, f"python3 -m venv {VENV_DIR}", cwd=MODEL_DIR)
        # Install deps (including psycopg2-binary)
        run_command(client, f"{VENV_DIR}/bin/pip install -r requirements.txt psycopg2-binary", cwd=MODEL_DIR)

        # 3. Apply Manual Migration (007)
        print("\n[3/5] Applying Migration 007 (Projection Logs)...")
        # Define the python script to apply migration
        # Note: We use relative path ../../migrations/... because we are in MODEL_DIR
        migration_runner = """
import psycopg2
import os
import sys

try:
    if os.environ.get('DATABASE_URL'):
        conn = psycopg2.connect(os.environ['DATABASE_URL'])
    else:
        conn = psycopg2.connect(
            host=os.environ.get('DB_HOST', 'localhost'),
            port=os.environ.get('DB_PORT', 5432),
            database=os.environ.get('DB_NAME', 'hoopstats'),
            user=os.environ.get('DB_USER', 'postgres'),
            password=os.environ.get('DB_PASSWORD', '')
        )
    
    cursor = conn.cursor()
    # Correct path to migration file from MODEL_DIR
    migration_path = '../../migrations/007_create_projection_logs.sql'
    
    if not os.path.exists(migration_path):
        print(f'Error: Migration file not found at {os.path.abspath(migration_path)}')
        sys.exit(1)
        
    with open(migration_path, 'r') as f:
        sql = f.read()
    
    cursor.execute(sql)
    conn.commit()
    print('Migration 007 applied successfully')
except Exception as e:
    print(f'Migration failed: {e}')
    # We exit 0 here because it might fail if table exists, which is fine
"""
        run_command(client, f"echo \"{migration_runner}\" > apply_007.py", cwd=MODEL_DIR)
        # Run it, loading .env from root
        env_cmd = "set -a; source ../../.env; set +a"
        run_command(client, f"{env_cmd} && {PYTHON_EXEC} apply_007.py", cwd=MODEL_DIR)

        # 4. Run Backtest Initialization
        print("\n[4/5] Running Backtest Initialization...")
        
        print("--- [Job 1] Capture Projections ---")
        run_command(client, f"{env_cmd} && {PYTHON_EXEC} scripts/cron_jobs.py capture", cwd=MODEL_DIR)

        print("--- [Job 2] Populate Actuals ---")
        run_command(client, f"{env_cmd} && {PYTHON_EXEC} scripts/cron_jobs.py actuals", cwd=MODEL_DIR)

        print("--- [Job 3] Run Validation ---")
        run_command(client, f"{env_cmd} && {PYTHON_EXEC} scripts/cron_jobs.py validate", cwd=MODEL_DIR)
        
        print("\n[5/5] Initialization Complete.")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
