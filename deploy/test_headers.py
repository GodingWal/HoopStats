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
        
        # Test with verbose headers
        print("=== Testing API with headers ===")
        stdin, stdout, stderr = client.exec_command("curl -sv http://localhost:5000/api/ref-signal/games 2>&1 | head -30")
        print(stdout.read().decode('utf-8', errors='replace')[:1500])
        
        # Get recent PM2 error logs  
        print("\n=== Recent PM2 error logs ===")
        stdin, stdout, stderr = client.exec_command("pm2 logs hoopstats --err --lines 20 --nostream 2>&1")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
