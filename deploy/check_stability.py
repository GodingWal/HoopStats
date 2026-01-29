import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    return out

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD)
    
    try:
        print("=== Waiting 10s to see if crash loop continues ===")
        time.sleep(10)
        
        print("=== PM2 Status (after 10s wait) ===")
        out = run_command(client, "pm2 status hoopstats")
        # PM2 status has unicode characters, just print safely
        for line in out.split('\n'):
            try:
                print(line)
            except:
                print("[Unable to print line]")
                
        print("\n=== Latest error logs (if any crashes) ===")
        out = run_command(client, "tail -10 /root/.pm2/logs/hoopstats-error.log 2>/dev/null | head -5")
        print(out or "No errors")
        
        print("\n=== Latest out logs ===")
        out = run_command(client, "tail -5 /root/.pm2/logs/hoopstats-out.log 2>/dev/null")
        print(out[:500] if out else "No logs")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
