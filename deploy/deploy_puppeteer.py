import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
SCRAPER_API_KEY = "544182204f978168adb0c0a1295bec06"

def run_command(client, command, timeout=180):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out[:3000]}")  # Limit output
    if err:
        print(f"Stderr:\n{err[:1000]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("DEPLOYING PUPPETEER SCRAPER")
    print("="*60)
    
    # Pull latest code
    print("\n[1] Pulling latest code...")
    run_command(client, "cd /var/www/hoopstats && git pull")
    
    # Install Chromium dependencies for Puppeteer
    print("\n[2] Installing Chromium dependencies...")
    run_command(client, """
        apt-get update && apt-get install -y \
        chromium-browser \
        libx11-xcb1 \
        libxcomposite1 \
        libxcursor1 \
        libxdamage1 \
        libxi6 \
        libxtst6 \
        libnss3 \
        libcups2 \
        libxss1 \
        libxrandr2 \
        libasound2 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libpangocairo-1.0-0 \
        libgtk-3-0 \
        fonts-liberation \
        libgbm-dev \
        --no-install-recommends
    """)
    
    # Install npm dependencies including puppeteer
    print("\n[3] Installing npm dependencies (including Puppeteer)...")
    run_command(client, "cd /var/www/hoopstats && npm install puppeteer")
    run_command(client, "cd /var/www/hoopstats && npm install")
    
    # Build
    print("\n[4] Building application...")
    run_command(client, "cd /var/www/hoopstats && npm run build")
    
    # Update ecosystem config with USE_PUPPETEER=true
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
      USE_PUPPETEER: 'true'
    }},
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }}]
}};'''
    
    print("\n[5] Updating ecosystem config with USE_PUPPETEER=true...")
    run_command(client, f"""cat > /var/www/hoopstats/ecosystem.config.cjs << 'EOFCONFIG'
{ecosystem_config}
EOFCONFIG""")
    
    # Delete old PM2 and restart
    print("\n[6] Restarting PM2...")
    run_command(client, "pm2 delete all")
    run_command(client, "cd /var/www/hoopstats && pm2 start ecosystem.config.cjs")
    run_command(client, "pm2 save")
    
    # Wait for app to start and Puppeteer to initialize
    print("\n[7] Waiting for app to start (20 seconds)...")
    time.sleep(20)
    
    # Check status and logs
    print("\n[8] Checking PM2 status...")
    run_command(client, "pm2 status")
    
    print("\n[9] Checking logs...")
    run_command(client, "pm2 logs hoopstats --lines 30 --nostream")
    
    # Test endpoint
    print("\n[10] Testing PrizePicks endpoint...")
    run_command(client, "curl -s 'http://localhost:5000/api/prizepicks/projections' | head -c 1500")
    
    client.close()
    print("\n" + "="*60)
    print("PUPPETEER DEPLOYMENT COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
