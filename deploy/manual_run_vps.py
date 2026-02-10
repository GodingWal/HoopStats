import paramiko
import time
import sys

# Fix for Windows Unicode output if possible
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
        
        print("=== Running node dist/index.cjs manually ===")
        # We run it with a timeout because it SHOULD block if it works.
        # We want to see the startup logs.
        cmd = "cd /var/www/hoopstats && node dist/index.cjs"
        
        # execution...
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # Read output for a few seconds
        start_time = time.time()
        while time.time() - start_time < 10:
            if stdout.channel.recv_ready():
                out = stdout.channel.recv(1024).decode('utf-8', errors='replace')
                sys.stdout.write(out)
                sys.stdout.flush()
            if stderr.channel.recv_ready():
                err = stderr.channel.recv(1024).decode('utf-8', errors='replace')
                sys.stderr.write(err)
                sys.stderr.flush()
            
            if stdout.channel.exit_status_ready():
                print("\nProcess exited!")
                break
            time.sleep(0.1)
            
        print("\n=== Stopping manual run ===")
        # We can't easily kill it via paramiko exec_command unless we opened a shell
        # But closing the client might kill it if not nohup'd? 
        # Actually usually it kills it.
        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
