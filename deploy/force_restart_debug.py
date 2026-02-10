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
        
        print("=== Stopping Server ===")
        client.exec_command("pm2 stop hoopstats")
        time.sleep(2)
        
        print("=== Flushing Logs ===")
        client.exec_command("pm2 flush")
        time.sleep(1)
        
        print("=== Starting Server ===")
        client.exec_command("pm2 restart hoopstats")
        
        print("Waiting for startup (5s)...")
        time.sleep(5)
        
        print("=== Reading Startup Logs (Head) ===")
        # Read the first 100 lines of the output log
        # The log file path might vary, standard is ~/.pm2/logs/hoopstats-out-0.log
        # or /root/.pm2/logs/hoopstats-out-0.log
        cmd = "head -n 100 /root/.pm2/logs/hoopstats-out-0.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        print("STDERR (if any):")
        print(stderr.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
