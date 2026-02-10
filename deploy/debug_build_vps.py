import paramiko
import time
import sys

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
        
        print("\n=== Running npm run build manually ===")
        # Clean dist first to be sure
        client.exec_command("rm -rf /var/www/hoopstats/dist")
        
        cmd = "cd /var/www/hoopstats && npm run build"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # Stream output
        while not stdout.channel.exit_status_ready():
            if stdout.channel.recv_ready():
                out = stdout.channel.recv(1024).decode('utf-8', errors='replace')
                sys.stdout.write(out)
            if stderr.channel.recv_ready():
                err = stderr.channel.recv(1024).decode('utf-8', errors='replace')
                sys.stderr.write(err)
            time.sleep(0.1)
            
        print("\n=== Build finished ===")
        exit_status = stdout.channel.recv_exit_status()
        print(f"Exit Status: {exit_status}")
        
        print("\n=== Checking for dist/index.cjs ===")
        cmd = "ls -l /var/www/hoopstats/dist/index.cjs"
        stdin, stdout, stderr = client.exec_command(cmd)
        out = stdout.read().decode().strip()
        print(out)
        if not out:
             print("File NOT found")
             print(stderr.read().decode())

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
