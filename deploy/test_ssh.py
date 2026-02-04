import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

print(f"Connecting to {HOST}...")

try:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected successfully!")
    
    # Test simple command
    stdin, stdout, stderr = client.exec_command("hostname && uptime")
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    print(f"Output: {out}")
    if err:
        print(f"Errors: {err}")
    
    client.close()
    print("Connection closed.")
    
except Exception as e:
    print(f"Failed: {type(e).__name__}: {e}")
