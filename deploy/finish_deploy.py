import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def run_command(client, command, timeout=600):
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print('='*60)
    
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    
    out = stdout.read().decode('utf-8', errors='replace').strip()
    err = stderr.read().decode('utf-8', errors='replace').strip()
    exit_code = stdout.channel.recv_exit_status()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    print(f"Exit code: {exit_code}")
    
    return exit_code == 0

def main():
    print(f"Connecting to {HOST}...")
    
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected successfully!")
        
        # Build
        print("\n[1/2] Building application...")
        run_command(client, f"cd {REMOTE_DIR} && npm run build", timeout=600)
        
        # Restart PM2
        print("\n[2/2] Restarting PM2...")
        run_command(client, f"cd {REMOTE_DIR} && pm2 restart hoopstats")
        
        # Check status
        print("\n[VERIFICATION] Checking PM2 status...")
        run_command(client, "pm2 status")
        
        # Check HTTPS/SSL
        print("\n[DIAGNOSIS] Checking Nginx and SSL...")
        run_command(client, "nginx -t")
        run_command(client, "certbot certificates")
        run_command(client, "cat /etc/nginx/sites-enabled/default | head -80")
        
        print("\n" + "="*60)
        print("DONE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
