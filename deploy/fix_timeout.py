import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
SCRAPER_API_KEY = "544182204f978168adb0c0a1295bec06"

def run_command(client, command, timeout=120):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out[:2000]}")
    if err:
        print(f"Stderr:\n{err[:500]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("FIXING 504 TIMEOUT")
    print("="*60)
    
    # 1. Update nginx config with longer timeout
    print("\n[1] Updating nginx timeout settings...")
    nginx_config = '''upstream hoopstats_backend {
    server 127.0.0.1:5000;
}

server {
    listen 80;
    listen [::]:80;
    server_name courtside-edge.com www.courtside-edge.com _;

    # Increase proxy timeouts
    proxy_connect_timeout 120s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;

    location / {
        proxy_pass http://hoopstats_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        
        # Buffer settings
        proxy_buffering on;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }
}'''
    run_command(client, f"""cat > /etc/nginx/sites-available/hoopstats << 'EOF'
{nginx_config}
EOF""")
    run_command(client, "nginx -t && systemctl reload nginx")
    
    # 2. Update ecosystem config to DISABLE Puppeteer (too slow)
    print("\n[2] Disabling Puppeteer (too slow, causes timeouts)...")
    ecosystem_config = f'''module.exports = {{
  apps: [{{
    name: 'hoopstats',
    script: 'dist/index.cjs',
    cwd: '/var/www/hoopstats',
    env: {{
      NODE_ENV: 'production',
      PORT: 5000,
      DATABASE_URL: 'postgres://hoopstats_user:HoopStats2026Secure!@localhost:5432/hoopstats',
      THE_ODDS_API_KEY: 'c5873a5a6e8bc29b33e7b9a69b974da5',
      SCRAPER_API_KEY: '{SCRAPER_API_KEY}',
      USE_PUPPETEER: 'false'
    }},
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }}]
}};'''
    
    run_command(client, f"""cat > /var/www/hoopstats/ecosystem.config.cjs << 'EOFCONFIG'
{ecosystem_config}
EOFCONFIG""")
    
    # 3. Restart PM2
    print("\n[3] Restarting PM2...")
    run_command(client, "pm2 delete all")
    run_command(client, "cd /var/www/hoopstats && pm2 start ecosystem.config.cjs")
    run_command(client, "pm2 save")
    
    time.sleep(5)
    
    # 4. Test
    print("\n[4] Testing health...")
    run_command(client, "curl -s http://localhost:5000/api/health")
    
    print("\n[5] Testing PrizePicks (quick)...")
    run_command(client, "timeout 10 curl -s 'http://localhost:5000/api/prizepicks/projections' | head -c 500 || echo 'Timed out (expected if no cache)'")
    
    client.close()
    print("\n" + "="*60)
    print("DONE - Puppeteer disabled, nginx timeout increased")
    print("="*60)

if __name__ == "__main__":
    main()
