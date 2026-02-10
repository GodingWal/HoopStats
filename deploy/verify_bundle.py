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
        
        print("=== Grepping Bundle ===")
        # Look for the debug log string I added
        cmd = "grep 'Hit PrizePicks Route' /var/www/hoopstats/dist/index.cjs"
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode()
        
        if output:
            print("Found 'Hit PrizePicks Route'!")
        else:
            print("NOT FOUND 'Hit PrizePicks Route'.")
            
        # Also look for the route definition string
        cmd = "grep '/api/ref-signal/prizepicks' /var/www/hoopstats/dist/index.cjs"
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode()
        
        if output:
            print("Found '/api/ref-signal/prizepicks'!")
        else:
            print("NOT FOUND '/api/ref-signal/prizepicks'.")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
