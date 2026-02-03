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
    print("CHECKING CONFIG AND PUPPETEER")
    print("="*60)
    
    # 1. Check ecosystem config
    print("\n[1] Checking ecosystem.config.cjs variable...")
    run_command(client, "grep USE_PUPPETEER /var/www/hoopstats/ecosystem.config.cjs")
    
    # 2. Check installed packages
    print("\n[2] Checking puppeteer version...")
    run_command(client, "cd /var/www/hoopstats && npm list puppeteer")
    
    # 3. Create and run a simple puppeteer test script
    test_script = """
const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Browser launched successfully!');
    const version = await browser.version();
    console.log('Browser version:', version);
    await browser.close();
    console.log('Browser closed.');
  } catch (err) {
    console.error('Failed to launch browser:', err);
    process.exit(1);
  }
})();
"""
    print("\n[3] Running Puppeteer launch test...")
    run_command(client, f"cat > /tmp/test_puppeteer.js << 'EOF'\n{test_script}\nEOF")
    run_command(client, "cd /var/www/hoopstats && node /tmp/test_puppeteer.js")
    
    client.close()
    print("\n" + "="*60)
    print("DONE")
    print("="*60)

if __name__ == "__main__":
    main()
