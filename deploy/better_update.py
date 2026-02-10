import paramiko
import time
import sys

# Fix for Windows Unicode output if possible
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Pulling latest code ===")
        stdin, stdout, stderr = client.exec_command("cd /var/www/hoopstats && git pull")
        out = stdout.read().decode('utf-8', errors='replace')
        print(out)
        err = stderr.read().decode('utf-8', errors='replace')
        if err: print(err)

        print("=== Rebuilding Server (TSC) ===")
        stdin, stdout, stderr = client.exec_command("cd /var/www/hoopstats && npm run build")
        
        # Stream output safely
        while not stdout.channel.exit_status_ready():
            if stdout.channel.recv_ready():
                out = stdout.channel.recv(1024).decode('utf-8', errors='replace')
                # Safely print
                try:
                    sys.stdout.write(out)
                except:
                    sys.stdout.write(out.encode('ascii', 'replace').decode('ascii'))
            
            if stderr.channel.recv_ready():
                err = stderr.channel.recv(1024).decode('utf-8', errors='replace')
                try:
                    sys.stderr.write(err)
                except:
                    sys.stderr.write(err.encode('ascii', 'replace').decode('ascii'))
            time.sleep(0.1)
            
        print("\n=== Restarting PM2 ===")
        stdin, stdout, stderr = client.exec_command("pm2 restart hoopstats")
        out = stdout.read().decode('utf-8', errors='replace')
        print(out)
        err = stderr.read().decode('utf-8', errors='replace')
        if err: print(err)

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
