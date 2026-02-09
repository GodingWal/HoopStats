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
        
        # Find what ports are in use
        print("=== Checking ports ===")
        stdin, stdout, stderr = client.exec_command("netstat -tlnp | grep node")
        print(stdout.read().decode('utf-8', errors='replace'))
        
        # Test different ports
        for port in [5000, 3000, 8080]:
            print(f"\n=== Testing port {port} ===")
            stdin, stdout, stderr = client.exec_command(f"curl -s -m 5 http://localhost:{port}/api/ref-signal/games 2>&1 | head -10")
            output = stdout.read().decode('utf-8', errors='replace')
            print(output[:500] if output else "(empty)")
        
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
