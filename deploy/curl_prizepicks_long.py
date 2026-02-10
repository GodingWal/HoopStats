import paramiko
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
        
        print("=== Curling /api/ref-signal/prizepicks (60s timeout) ===")
        cmd = "curl -s --max-time 60 http://localhost:5000/api/ref-signal/prizepicks | head -c 2000"
        stdin, stdout, stderr = client.exec_command(cmd, timeout=90)
        out = stdout.read().decode('utf-8', errors='replace')
        print(out)
        err = stderr.read().decode('utf-8', errors='replace')
        if err:
            print("STDERR:", err)

        client.close()
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
