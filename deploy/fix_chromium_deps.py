import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=180):
    print(f"\nRunning: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out[:3000]}")
    if err:
        print(f"Stderr:\n{err[:1500]}")
    return exit_status == 0

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("FIXING PUPPETEER CHROMIUM DEPENDENCIES")
    print("="*60)
    
    # Install ALL Chromium dependencies with full package names
    print("\n[1] Installing ALL Chromium dependencies...")
    run_command(client, """
        apt-get update && apt-get install -y \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
        libpango-1.0-0 \
        libpangocairo-1.0-0 \
        libcairo2 \
        libnss3 \
        libnspr4 \
        libx11-6 \
        libx11-xcb1 \
        libxcb1 \
        libxext6 \
        libxshmfence1 \
        libglib2.0-0 \
        libgdk-pixbuf2.0-0 \
        libgtk-3-0 \
        fonts-liberation \
        xdg-utils \
        wget \
        ca-certificates \
        --no-install-recommends
    """)
    
    # Test Puppeteer browser launch
    print("\n[2] Testing Puppeteer browser launch...")
    run_command(client, """cd /var/www/hoopstats && node -e "
        const puppeteer = require('puppeteer');
        (async () => {
            console.log('Launching browser...');
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
            });
            console.log('SUCCESS! Browser launched!');
            console.log('Browser version:', await browser.version());
            await browser.close();
            console.log('Browser closed cleanly.');
        })().catch(err => {
            console.error('Puppeteer error:', err.message);
            process.exit(1);
        });
    "
    """)
    
    # Restart PM2 to clear any cached errors
    print("\n[3] Restarting PM2...")
    run_command(client, "pm2 restart hoopstats")
    
    time.sleep(15)
    
    # Test PrizePicks endpoint
    print("\n[4] Testing PrizePicks endpoint...")
    run_command(client, "curl -s 'http://localhost:5000/api/prizepicks/projections' | head -c 2000")
    
    # Check logs
    print("\n[5] Checking logs for Puppeteer messages...")
    run_command(client, "pm2 logs hoopstats --lines 30 --nostream | grep -i puppeteer")
    
    client.close()
    print("\n" + "="*60)
    print("FIX COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
