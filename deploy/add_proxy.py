import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
SCRAPER_API_KEY = "544182204f978168adb0c0a1295bec06"

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
    print("ADDING SCRAPERAPI PROXY")
    print("="*60)
    
    # ScraperAPI proxy format
    proxy_url = f"http://scraperapi:{SCRAPER_API_KEY}@proxy-server.scraperapi.com:8001"
    
    # Create updated ecosystem config with PROXY_LIST
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
      SCRAPER_API_KEY: 'abe0ac49c9e68691cd38a1972b254f35',
      PROXY_LIST: '{proxy_url}'
    }},
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }}]
}};'''
    
    print("\n[1] Writing updated ecosystem config with proxy...")
    run_command(client, f"""cat > /var/www/hoopstats/ecosystem.config.cjs << 'EOFCONFIG'
{ecosystem_config}
EOFCONFIG""")
    
    print("\n[2] Deleting old PM2 process...")
    run_command(client, "pm2 delete all")
    
    print("\n[3] Starting PM2 with new config...")
    run_command(client, "cd /var/www/hoopstats && pm2 start ecosystem.config.cjs")
    
    print("\n[4] Saving PM2 config...")
    run_command(client, "pm2 save")
    
    import time
    time.sleep(5)  # Wait for app to fully start
    
    print("\n[5] Checking PM2 status...")
    run_command(client, "pm2 status")
    
    print("\n[6] Checking PM2 logs for proxy loading...")
    run_command(client, "pm2 logs hoopstats --lines 20 --nostream")
    
    print("\n[7] Testing PrizePicks endpoint...")
    run_command(client, "curl -s http://localhost:5000/api/prizepicks/projections | head -c 500")
    
    client.close()
    print("\n" + "="*60)
    print("PROXY CONFIGURATION COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
