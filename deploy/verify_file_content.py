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
        
        print("=== Checking ref-signal.js Content ===")
        cmd = "cat /var/www/hoopstats/dist/server/routes/ref-signal.js"
        # Since file is large? It shouldn't be too large.
        stdin, stdout, stderr = client.exec_command(cmd)
        output = stdout.read().decode()
        
        if "prizepicks" in output:
            print("Found 'prizepicks' in file!")
            # Print context
            lines = output.split('\n')
            for i, line in enumerate(lines):
                if "prizepicks" in line:
                    print(f"{i}: {line}")
        else:
            print("'prizepicks' NOT found in file.")
            print("File start:")
            print(output[:500])

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
