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
        
        print("=== Quick Curl Check GAMES (Port 5000) ===")
        cmd = "curl -v --max-time 10 http://localhost:5000/api/ref-signal/games"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        print(stdout.read().decode())
        print(stderr.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
