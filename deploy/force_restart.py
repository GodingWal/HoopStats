import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

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
    print("FORCING RESTART & MONITORING")
    print("="*60)
    
    # Force restart
    print("\n[1] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    # Check status
    print("\n[2] Checking Status (should be 0s uptime)...")
    run_command(client, "pm2 status hoopstats")
    
    # Watch logs for 30 seconds
    print("\n[3] Watching logs for 30s...")
    cmd = "timeout 30 tail -f /root/.pm2/logs/hoopstats-out.log"
    # Execute and stream
    stdin, stdout, stderr = client.exec_command(cmd)
    
    start_time = time.time()
    while time.time() - start_time < 35:
        if stdout.channel.recv_ready():
            line = stdout.channel.recv(1024).decode('utf-8', errors='ignore')
            sys.stdout.write(line)
        if stdout.channel.exit_status_ready():
            break
        time.sleep(0.5)
            
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
