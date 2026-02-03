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
    
    print("\n" + "="*60)
    print("DEBUGGING PUPPETEER")
    print("="*60)
    
    # Check if Chromium is installed
    print("\n[1] Checking Chromium installation...")
    run_command(client, "which chromium-browser || which chromium")
    run_command(client, "chromium --version 2>/dev/null || chromium-browser --version 2>/dev/null")
    
    # Check PM2 env vars
    print("\n[2] Checking PM2 environment...")
    run_command(client, "pm2 env 0 | grep -E '(USE_PUPPETEER|SCRAPER)'")
    
    # Check full error logs
    print("\n[3] Full recent error logs...")
    run_command(client, "pm2 logs hoopstats --lines 50 --nostream")
    
    # Test if Puppeteer can launch browser
    print("\n[4] Testing Puppeteer directly...")
    run_command(client, """cd /var/www/hoopstats && node -e "
        const puppeteer = require('puppeteer');
        (async () => {
            console.log('Launching browser...');
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            console.log('Browser launched successfully!');
            console.log('Browser version:', await browser.version());
            await browser.close();
            console.log('Browser closed.');
        })().catch(err => {
            console.error('Puppeteer error:', err.message);
            process.exit(1);
        });
    "
    """)
    
    client.close()
    print("\n" + "="*60)
    print("DEBUG COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
