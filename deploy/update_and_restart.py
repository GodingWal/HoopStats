import paramiko
import time

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
        print(stdout.read().decode())
        print(stderr.read().decode())

        print("=== Rebuilding Server (TSC) ===")
        # Usually npm run build:server or tsc
        # Check package.json scripts?
        # Assuming tsx runs directly or we need to build for distribution?
        # App runs via `dist/index.cjs`?
        # `npm run build` builds everything.
        # `npm run build:server`?
        # Let's try `npm run build` or just restart if it uses ts-node/tsx (unlikely in prod).
        # Previous deployment logs suggested `npm run build`.
        
        # But building takes time.
        # Check if `npm run build` is needed. Yes, likely.
        
        print("Building...")
        stdin, stdout, stderr = client.exec_command("cd /var/www/hoopstats && npm run build")
        # Stream output?
        while True:
            line = stdout.readline()
            if not line:
                break
            print(line.strip())
        print(stderr.read().decode())

        print("=== Restarting PM2 ===")
        stdin, stdout, stderr = client.exec_command("pm2 restart hoopstats")
        print(stdout.read().decode())
        print(stderr.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
