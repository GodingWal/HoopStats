import paramiko
import json

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Checking PM2 JList ===")
        cmd = "pm2 jlist"
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode()
        
        try:
            processes = json.loads(output)
            for p in processes:
                print(f"Name: {p['name']}")
                print(f"Log Out: {p['pm2_env']['pm_out_log_path']}")
                print(f"Log Err: {p['pm2_env']['pm_err_log_path']}")
        except Exception as e:
            print(f"Failed to parse JSON: {e}")
            print(output[:200]) # print start

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
