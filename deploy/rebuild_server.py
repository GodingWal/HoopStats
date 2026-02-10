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
        
        print("=== Rebuilding Server ===")
        # Redirect output to file to avoid buffer issues or encoding issues
        cmd = "cd /var/www/hoopstats && npm run build > build_debug.log 2>&1"
        print(f"Executing: {cmd}")
        stdin, stdout, stderr = client.exec_command(cmd)
        
        # This might take time. We wait loop checking file size or process?
        # Or just wait for command to exit (recv_exit_status).
        exit_status = stdout.channel.recv_exit_status()
        print(f"Build Exit Status: {exit_status}")
        
        print("=== Build Output ===")
        cmd = "cat /var/www/hoopstats/build_debug.log"
        stdin, stdout, stderr = client.exec_command(cmd)
        print(stdout.read().decode())
        
        if exit_status == 0:
            print("=== Restarting PM2 ===")
            stdin, stdout, stderr = client.exec_command("pm2 restart hoopstats")
            print(stdout.read().decode())
            print(stderr.read().decode())
        else:
            print("Build failed. Not restarting.")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
