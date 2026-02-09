import paramiko
import sys

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
REMOTE_DIR = "/var/www/hoopstats"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Build and restart
        cmd = f"cd {REMOTE_DIR} && npm run build && pm2 restart hoopstats && pm2 status"
        print("Building and restarting...")
        stdin, stdout, stderr = client.exec_command(cmd, timeout=180, get_pty=True)
        
        # Read with proper handling
        for line in stdout:
            try:
                sys.stdout.write(line)
            except:
                pass
        
        client.close()
        print("\nDone!")
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
