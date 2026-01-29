import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD)
    
    try:
        print("=== 1. Checking PM2 process status ===")
        out, _ = run_command(client, "pm2 status")
        print(out)
        
        print("=== 2. Checking for JS syntax errors ===")
        out, err = run_command(client, "node --check /var/www/hoopstats/dist/public/assets/index-CWYhc6xh.js 2>&1 | head -5")
        print(out or err or "No syntax errors detected")
        
        print("=== 3. Checking CSS file exists ===")
        out, _ = run_command(client, "ls -la /var/www/hoopstats/dist/public/assets/index-*.css")
        print(out)
        
        print("=== 4. Testing CSS file HTTP response ===")
        out, _ = run_command(client, "curl -s -I https://courtside-edge.com/assets/index-DM4oTDPB.css | head -5")
        print(out)
        
        print("=== 5. Checking recent error logs ===")
        out, _ = run_command(client, "tail -30 /root/.pm2/logs/hoopstats-error.log | grep -v 'WARN' | tail -10")
        print(out or "No non-warning errors")
        
        print("=== 6. Checking if JS imports React correctly ===")
        out, _ = run_command(client, "head -c 1000 /var/www/hoopstats/dist/public/assets/index-CWYhc6xh.js | grep -o 'React\\|createRoot\\|render' | head -5")
        print(out or "React keywords not found in first 1000 chars")
        
        print("=== 7. Testing full page load time ===")
        out, _ = run_command(client, "time curl -s https://courtside-edge.com/ > /dev/null")
        print(out or "Completed")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
