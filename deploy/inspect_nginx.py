
import paramiko
import sys

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USERNAME, password=PASSWORD)
        return client
    except Exception as e:
        print(f"Failed to connect: {e}")
        sys.exit(1)

def run_command(client, command):
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Error:\n{err}")

def main():
    client = create_ssh_client()
    try:
        print("Checking Nginx Sites Available:")
        run_command(client, "ls -F /etc/nginx/sites-available/")
        
        print("\nChecking Nginx Sites Enabled:")
        run_command(client, "ls -F /etc/nginx/sites-enabled/")
        
        print("\nContent of default config:")
        run_command(client, "cat /etc/nginx/sites-enabled/default")

        print("\nChecking Certbot certificates:")
        run_command(client, "certbot certificates")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
