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
        
        print("=== Checking Recent Error Logs ===")
        # Use tail -f style? No, just tail -n 100
        cmd = "tail -n 100 /root/.pm2/logs/hoopstats-error.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())

        print("=== Checking Recent Out Logs ===")
        cmd = "tail -n 50 /root/.pm2/logs/hoopstats-out.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
