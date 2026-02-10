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
        
        print("=== Checking Date ===")
        stdin, stdout, stderr = client.exec_command("date")
        print(stdout.read().decode())
        
        print("=== Checking PM2 Status ===")
        # Force column output or json
        cmd = "pm2 jlist"
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode()
        if output:
            try:
                import json
                processes = json.loads(output)
                for p in processes:
                    print(f"Name: {p['name']}, Status: {p['pm2_env']['status']}, Restarts: {p['pm2_env']['restart_time']}")
            except:
                 print("Raw output:")
                 print(output)
        else:
            print("No output from pm2 jlist")
            print(stderr.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
