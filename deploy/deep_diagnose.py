import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=60):
    print(f"\n{'='*60}")
    print(f"Running: {command}")
    print('='*60)
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
    print("DEEP DIAGNOSIS")
    print("="*60)
    
    # Check current nginx site config
    print("\n[1] Current Nginx site configuration:")
    run_command(client, "cat /etc/nginx/sites-enabled/hoopstats")
    
    # Check the main nginx.conf to see if it's including sites-enabled
    print("\n[2] Nginx main config (sites-enabled include):")
    run_command(client, "grep -A2 'sites-enabled' /etc/nginx/nginx.conf")
    
    # Check PM2 logs for any errors
    print("\n[3] Recent PM2 error logs:")
    run_command(client, "pm2 logs hoopstats --err --lines 20 --nostream")
    
    # Full test from inside the server
    print("\n[4] Testing full page load via nginx (first 100 chars):")
    run_command(client, "curl -s http://localhost:80 | head -c 500")
    
    # Check if there's an IPv6 issue - add [::]:80
    print("\n[5] Updating nginx to also listen on IPv6:")
    nginx_config = '''server {
    listen 80;
    listen [::]:80;
    server_name courtside-edge.com www.courtside-edge.com _;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}'''
    
    run_command(client, f"""cat > /etc/nginx/sites-available/hoopstats << 'EOF'
{nginx_config}
EOF""")
    
    # Test and reload
    print("\n[6] Testing and reloading nginx:")
    run_command(client, "nginx -t && systemctl reload nginx")
    
    # Check listening again
    print("\n[7] Verify listening ports after update:")
    run_command(client, "ss -tlnp | grep nginx")
    
    # External test simulation
    print("\n[8] Final health check:")
    run_command(client, "curl -s http://127.0.0.1/api/health")
    
    client.close()
    print("\n" + "="*60)
    print("DIAGNOSIS COMPLETE - Try accessing http://courtside-edge.com now")
    print("="*60)

if __name__ == "__main__":
    main()
