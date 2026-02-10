import paramiko
import sys

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Listing dist/ ===")
        cmd = "ls -l /var/www/hoopstats/dist/"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())

        print("=== Reading build_debug.log Safely ===")
        cmd = "cat /var/www/hoopstats/build_debug.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # Read bytes
        content_bytes = stdout.read()
        # Decode and ignore errors
        content = content_bytes.decode('utf-8', errors='replace')
        
        # Print with replacement for console
        # Windows console might still fail if we print unencodable chars even if python string has them?
        # Use sys.stdout.buffer.write if needed, or just ascii.
        print(content.encode('ascii', 'replace').decode('ascii'))
        
        err = stderr.read().decode('utf-8', errors='replace')
        if err:
            print("STDERR:")
            print(err)

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
