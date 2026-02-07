import paramiko
import sys
import time
import socket

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def run_command(client, command, timeout=300):
    """Run a command with proper timeout handling using channels."""
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print(f"Timeout: {timeout}s")
    print('='*60)
    
    # Use transport channel for better timeout control
    transport = client.get_transport()
    channel = transport.open_session()
    channel.settimeout(timeout)
    
    try:
        channel.exec_command(command)
        
        # Read output with timeout
        stdout_data = b''
        stderr_data = b''
        
        start_time = time.time()
        while True:
            # Check if we've exceeded timeout
            elapsed = time.time() - start_time
            if elapsed > timeout:
                print(f"Command timed out after {timeout}s")
                channel.close()
                return False
            
            # Check if command is done
            if channel.exit_status_ready():
                # Read any remaining data
                while channel.recv_ready():
                    stdout_data += channel.recv(4096)
                while channel.recv_stderr_ready():
                    stderr_data += channel.recv_stderr(4096)
                break
            
            # Read available data (non-blocking due to timeout)
            try:
                if channel.recv_ready():
                    chunk = channel.recv(4096)
                    stdout_data += chunk
                    # Print output in real-time
                    print(chunk.decode('utf-8', errors='replace'), end='', flush=True)
                if channel.recv_stderr_ready():
                    stderr_data += channel.recv_stderr(4096)
            except socket.timeout:
                continue
            
            time.sleep(0.1)
        
        exit_code = channel.recv_exit_status()
        
        # Print any remaining output
        out = stdout_data.decode('utf-8', errors='replace').strip()
        err = stderr_data.decode('utf-8', errors='replace').strip()
        
        if err:
            print(f"\nStderr:\n{err}")
        print(f"\nExit code: {exit_code}")
        
        channel.close()
        return exit_code == 0
        
    except socket.timeout:
        print(f"Socket timeout after {timeout}s")
        channel.close()
        return False
    except Exception as e:
        print(f"Error: {type(e).__name__}: {e}")
        channel.close()
        return False

def main():
    print(f"Connecting to {HOST}...")
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected successfully!")
        
        # Step 1: Git sync (short timeout)
        print("\n[1/5] Syncing with GitHub...")
        if not run_command(client, f"cd {REMOTE_DIR} && git fetch --all && git reset --hard origin/main", timeout=60):
            print("WARNING: Git sync had issues")
        
        # Step 2: Install dependencies (longer timeout)
        print("\n[2/5] Installing dependencies...")
        run_command(client, f"cd {REMOTE_DIR} && npm install", timeout=180)
        
        # Step 3: Run db:push (can take time)
        print("\n[3/5] Running database migrations...")
        run_command(client, f"cd {REMOTE_DIR} && npm run db:push", timeout=120)
        
        # Step 4: Build (can take time)
        print("\n[4/5] Building application...")
        run_command(client, f"cd {REMOTE_DIR} && npm run build", timeout=300)
        
        # Step 5: Restart PM2
        print("\n[5/5] Restarting PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats", timeout=30)
        
        # Check status
        print("\n[VERIFICATION] Checking PM2 status...")
        run_command(client, "pm2 status", timeout=10)
        
        print("\n" + "="*60)
        print("UPDATE COMPLETE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
