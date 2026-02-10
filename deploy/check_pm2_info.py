import paramiko
import time
import sys

# Fix for Windows Unicode output if possible, or just be safe
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except:
        pass

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Checking PM2 Info Safely ===")
        # Redirect output and cat it
        cmd = "pm2 show hoopstats > pm2_info.txt"
        client.exec_command(cmd)
        time.sleep(1)
        
        cmd = "cat pm2_info.txt"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        content = stdout.read().decode('utf-8', errors='replace')
        
        # Safely print by encoding to ascii and decoding back
        safe_content = content.encode('ascii', 'replace').decode('ascii')
        print(safe_content)
        
        err = stderr.read().decode('utf-8', errors='replace')
        if err:
            print("STDERR:")
            print(err.encode('ascii', 'replace').decode('ascii'))

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
