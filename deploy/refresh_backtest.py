import paramiko
import sys
import select

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
MODEL_DIR = "/var/www/hoopstats/server/nba-prop-model"
VENV_PYTHON = f"{MODEL_DIR}/venv/bin/python"

def run_with_streaming(client, command, timeout=120):
    """Run command with streaming output to avoid buffering issues."""
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print('='*60)
    
    # Use get_transport and open channel for better control
    transport = client.get_transport()
    channel = transport.open_session()
    channel.settimeout(timeout)
    channel.exec_command(command)
    
    output = []
    errors = []
    
    # Read output in chunks
    while True:
        if channel.exit_status_ready():
            # Read any remaining data
            while channel.recv_ready():
                chunk = channel.recv(4096).decode('utf-8', errors='replace')
                output.append(chunk)
                print(chunk, end='', flush=True)
            while channel.recv_stderr_ready():
                chunk = channel.recv_stderr(4096).decode('utf-8', errors='replace')
                errors.append(chunk)
                print(f"[ERR] {chunk}", end='', flush=True)
            break
        
        # Check for data
        if channel.recv_ready():
            chunk = channel.recv(4096).decode('utf-8', errors='replace')
            output.append(chunk)
            print(chunk, end='', flush=True)
        
        if channel.recv_stderr_ready():
            chunk = channel.recv_stderr(4096).decode('utf-8', errors='replace')
            errors.append(chunk)
            print(f"[ERR] {chunk}", end='', flush=True)
    
    exit_code = channel.recv_exit_status()
    print(f"\nExit code: {exit_code}")
    channel.close()
    
    return exit_code == 0

def main():
    print(f"Connecting to {HOST}...")
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected!")
        
        env_cmd = "export $(cat /var/www/hoopstats/.env | xargs)"
        
        # Just run validate for now to get backtest results
        print("\nRunning backtest validation...")
        run_with_streaming(
            client, 
            f"cd {MODEL_DIR} && {env_cmd} && {VENV_PYTHON} scripts/cron_jobs.py validate",
            timeout=120
        )
        
        print("\n" + "="*60)
        print("DONE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
