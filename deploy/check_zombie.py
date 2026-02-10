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
        
        print("=== Stopping PM2 Process ===")
        client.exec_command("pm2 stop hoopstats")
        time.sleep(3)
        
        print("=== Checking Port 5000 ===")
        # Check if anything is listening on 5000
        cmd = "lsof -i :5000"
        stdin, stdout, stderr = client.exec_command(cmd)
        print("LSOF output:")
        print(stdout.read().decode())
        
        # Try to curl
        print("=== Curling while stopped ===")
        cmd = "curl -v --max-time 5 http://localhost:5000/api/ref-signal/games"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        print(stderr.read().decode())
        
        print("=== Restarting PM2 Process (cleanup) ===")
        client.exec_command("pm2 restart hoopstats")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
