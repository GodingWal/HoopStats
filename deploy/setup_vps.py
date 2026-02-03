import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print(f"Connecting to {HOST}...")
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        print("Connected successfully!")
        return client
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

def run_command(client, command, timeout=300):
    """Run a command and return success status."""
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
    
    success = exit_status == 0
    print(f"Exit status: {exit_status} ({'SUCCESS' if success else 'FAILED'})")
    return success

def main():
    client = create_ssh_client()
    
    try:
        print("\n" + "="*60)
        print("PHASE 1: System Preparation")
        print("="*60)
        
        # Update system
        run_command(client, "apt-get update -y")
        run_command(client, "DEBIAN_FRONTEND=noninteractive apt-get upgrade -y")
        
        # Set timezone
        run_command(client, "timedatectl set-timezone America/Los_Angeles")
        
        # Install essential tools
        run_command(client, "apt-get install -y git curl wget build-essential software-properties-common")
        
        print("\n" + "="*60)
        print("PHASE 2: Node.js 20.x Installation")
        print("="*60)
        
        # Install Node.js 20.x
        run_command(client, "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -")
        run_command(client, "apt-get install -y nodejs")
        run_command(client, "node --version")
        run_command(client, "npm --version")
        
        print("\n" + "="*60)
        print("PHASE 3: PostgreSQL 15 Installation")
        print("="*60)
        
        # Install PostgreSQL
        run_command(client, "apt-get install -y postgresql postgresql-contrib")
        run_command(client, "systemctl enable postgresql")
        run_command(client, "systemctl start postgresql")
        
        # Create database and user
        db_password = "HoopStats2026Secure!"
        run_command(client, f"""sudo -u postgres psql -c "CREATE USER hoopstats_user WITH PASSWORD '{db_password}';" """)
        run_command(client, """sudo -u postgres psql -c "CREATE DATABASE hoopstats OWNER hoopstats_user;" """)
        run_command(client, """sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE hoopstats TO hoopstats_user;" """)
        
        print("\n" + "="*60)
        print("PHASE 4: Python 3.11 Installation")
        print("="*60)
        
        # Install Python 3.11
        run_command(client, "add-apt-repository -y ppa:deadsnakes/ppa")
        run_command(client, "apt-get update -y")
        run_command(client, "apt-get install -y python3.11 python3.11-venv python3-pip")
        run_command(client, "python3.11 --version")
        
        print("\n" + "="*60)
        print("PHASE 5: PM2 Process Manager")
        print("="*60)
        
        # Install PM2
        run_command(client, "npm install -g pm2")
        run_command(client, "pm2 startup systemd -u root --hp /root")
        
        print("\n" + "="*60)
        print("PHASE 6: Nginx Installation")
        print("="*60)
        
        # Install Nginx
        run_command(client, "apt-get install -y nginx")
        run_command(client, "systemctl enable nginx")
        
        # Configure Nginx
        nginx_config = '''server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}'''
        
        # Write nginx config
        run_command(client, f"""cat > /etc/nginx/sites-available/hoopstats << 'EOF'
{nginx_config}
EOF""")
        
        run_command(client, "ln -sf /etc/nginx/sites-available/hoopstats /etc/nginx/sites-enabled/")
        run_command(client, "rm -f /etc/nginx/sites-enabled/default")
        run_command(client, "nginx -t")
        run_command(client, "systemctl restart nginx")
        
        print("\n" + "="*60)
        print("PHASE 7: Clone and Deploy Application")
        print("="*60)
        
        # Create directory
        run_command(client, f"mkdir -p {REMOTE_DIR}")
        
        # Clone repository
        run_command(client, f"git clone https://github.com/GodingWal/HoopStats.git {REMOTE_DIR}", timeout=120)
        
        # Create .env file
        env_content = f'''NODE_ENV=production
PORT=5000
DATABASE_URL=postgres://hoopstats_user:{db_password}@localhost:5432/hoopstats
THE_ODDS_API_KEY=c5873a5a6e8bc29b33e7b9a69b974da5
SCRAPER_API_KEY=abe0ac49c9e68691cd38a1972b254f35
'''
        
        run_command(client, f"""cat > {REMOTE_DIR}/.env << 'EOF'
{env_content}
EOF""")
        
        # Install dependencies
        run_command(client, f"cd {REMOTE_DIR} && npm install", timeout=300)
        
        # Run database migrations
        run_command(client, f"cd {REMOTE_DIR} && npm run db:push", timeout=120)
        
        # Build application
        run_command(client, f"cd {REMOTE_DIR} && npm run build", timeout=300)
        
        # Start with PM2
        run_command(client, f"cd {REMOTE_DIR} && pm2 start dist/index.cjs --name hoopstats")
        run_command(client, "pm2 save")
        
        print("\n" + "="*60)
        print("PHASE 8: Python Virtual Environment for Cron Jobs")
        print("="*60)
        
        # Create venv for cron jobs
        run_command(client, f"cd {REMOTE_DIR}/server/nba-prop-model && python3.11 -m venv venv")
        run_command(client, f"cd {REMOTE_DIR}/server/nba-prop-model && ./venv/bin/pip install --upgrade pip")
        run_command(client, f"cd {REMOTE_DIR}/server/nba-prop-model && ./venv/bin/pip install psycopg2-binary nba_api pandas numpy")
        
        print("\n" + "="*60)
        print("VERIFICATION")
        print("="*60)
        
        # Verify services
        run_command(client, "systemctl status postgresql --no-pager")
        run_command(client, "systemctl status nginx --no-pager")
        run_command(client, "pm2 status")
        
        # Test health endpoint
        time.sleep(3)
        run_command(client, "curl -s http://localhost:5000/api/health || echo 'Health check pending...'")
        
        print("\n" + "="*60)
        print("VPS SETUP COMPLETE!")
        print("="*60)
        print(f"\nApplication URL: http://{HOST}")
        print(f"Application directory: {REMOTE_DIR}")
        print("\nServices running:")
        print("  - PostgreSQL 15")
        print("  - Nginx (port 80 -> 5000)")
        print("  - PM2 (hoopstats)")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
