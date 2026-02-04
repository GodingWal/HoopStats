import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
DOMAIN = "courtside-edge.com"
EMAIL = "admin@courtside-edge.com"

def run_command(client, command, timeout=300):
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
        
        # First check current nginx config
        print("\n[1/6] Checking nginx config location...")
        run_command(client, "ls -la /etc/nginx/sites-enabled/ 2>/dev/null || ls -la /etc/nginx/conf.d/")
        run_command(client, "cat /etc/nginx/nginx.conf | grep -A5 'server {'")
        
        # Check what's listening on port 80 and 443
        print("\n[2/6] Checking ports...")
        run_command(client, "ss -tlnp | grep -E ':80|:443'")
        
        # Install certbot
        print("\n[3/6] Installing Certbot...")
        run_command(client, "apt-get update && apt-get install -y certbot python3-certbot-nginx", timeout=180)
        
        # Check if nginx config file exists
        print("\n[4/6] Finding nginx config...")
        run_command(client, "find /etc/nginx -name '*.conf' -type f | head -20")
        run_command(client, "cat /etc/nginx/conf.d/hoopstats.conf 2>/dev/null || echo 'No hoopstats.conf'")
        
        # Get/renew SSL certificate
        print(f"\n[5/6] Getting SSL certificate for {DOMAIN}...")
        cmd = f"certbot --nginx -d {DOMAIN} -d www.{DOMAIN} --non-interactive --agree-tos -m {EMAIL} --redirect"
        run_command(client, cmd, timeout=120)
        
        # Reload nginx
        print("\n[6/6] Reloading Nginx...")
        run_command(client, "nginx -t && systemctl reload nginx")
        
        # Verify SSL
        print("\n[VERIFICATION] Checking SSL certificates...")
        run_command(client, "certbot certificates")
        
        print("\n" + "="*60)
        print("SSL SETUP COMPLETE!")
        print("="*60)
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
