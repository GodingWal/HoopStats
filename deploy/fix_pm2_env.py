import paramiko
import sys

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
    
    # Stop the current PM2 process
    print("\n[1] Stopping current PM2 process...")
    run_command(client, "pm2 delete all")
    
    # Create an ecosystem.config.js file to properly load env vars
    print("\n[2] Creating PM2 ecosystem config...")
    ecosystem_config = '''module.exports = {
  apps: [{
    name: 'hoopstats',
    script: 'dist/index.cjs',
    cwd: '/var/www/hoopstats',
    env: {
      NODE_ENV: 'production',
      PORT: 5000,
      DATABASE_URL: 'postgres://hoopstats_user:HoopStats2026Secure!@localhost:5432/hoopstats',
      THE_ODDS_API_KEY: 'c5873a5a6e8bc29b33e7b9a69b974da5',
      SCRAPER_API_KEY: 'abe0ac49c9e68691cd38a1972b254f35'
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};'''
    
    run_command(client, f"""cat > /var/www/hoopstats/ecosystem.config.cjs << 'EOF'
{ecosystem_config}
EOF""")
    
    # Start PM2 with ecosystem config
    print("\n[3] Starting PM2 with ecosystem config...")
    run_command(client, "cd /var/www/hoopstats && pm2 start ecosystem.config.cjs")
    
    # Save PM2 config
    print("\n[4] Saving PM2 config...")
    run_command(client, "pm2 save")
    
    # Wait a moment for startup
    import time
    time.sleep(3)
    
    # Check status
    print("\n[5] Checking PM2 status...")
    run_command(client, "pm2 status")
    
    # Test health endpoint
    print("\n[6] Testing health endpoint...")
    run_command(client, "curl -s http://localhost:5000/api/health")
    
    # Check for any startup errors
    print("\n[7] Checking PM2 logs for errors...")
    run_command(client, "pm2 logs hoopstats --err --lines 10 --nostream")
    
    client.close()
    print("\n" + "="*60)
    print("PM2 RESTART COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
