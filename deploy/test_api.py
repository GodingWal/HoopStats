import paramiko

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        # Test the API endpoint on the correct port (where PM2 is running)
        print("\n=== Testing games API on port 3000 ===")
        stdin, stdout, stderr = client.exec_command("curl -s http://localhost:3000/api/ref-signal/games 2>&1")
        print(stdout.read().decode('utf-8', errors='replace')[:2000])
        
        # Check what port hoopstats is running on
        print("\n=== PM2 Status ===")
        stdin, stdout, stderr = client.exec_command("pm2 show hoopstats 2>&1 | grep -E '(port|status|pid)'")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
