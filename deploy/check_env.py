import paramiko
import sys

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USERNAME, password=PASSWORD)
        
        print("Checking .env file...")
        stdin, stdout, stderr = client.exec_command("ls -l /var/www/hoopstats/.env")
        print(f"File: {stdout.read().decode().strip()}")
        
        print("Checking content keys...")
        stdin, stdout, stderr = client.exec_command("cat /var/www/hoopstats/.env")
        content = stdout.read().decode().strip()
        
        if not content:
            print("ERROR: .env file is empty!")
            return

        print(f"Has DATABASE_URL: {'DATABASE_URL' in content}")
        print(f"Has OPENAI_API_KEY: {'OPENAI_API_KEY' in content}")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
