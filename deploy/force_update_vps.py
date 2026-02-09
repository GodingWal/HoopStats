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
        
        commands = [
            # Reset local changes and force pull
            f"cd {REMOTE_DIR} && git fetch origin",
            f"cd {REMOTE_DIR} && git reset --hard origin/main",
            f"cd {REMOTE_DIR} && git log --oneline -2",
            # Rebuild
            f"cd {REMOTE_DIR} && npm run build 2>&1 | tail -5",
            # Restart
            f"cd {REMOTE_DIR} && pm2 restart hoopstats",
        ]
        
        for cmd in commands:
            print(f"\n>>> {cmd[:70]}...")
            stdin, stdout, stderr = client.exec_command(cmd, timeout=180, get_pty=True)
            for line in stdout:
                try:
                    sys.stdout.write(line)
                except:
                    pass
        
        client.close()
        print("\n\nDone!")
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
