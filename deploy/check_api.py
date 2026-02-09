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
        
        # Test the API
        print("=== Testing games API ===")
        stdin, stdout, stderr = client.exec_command("curl -s http://localhost:5000/api/ref-signal/games 2>&1")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
