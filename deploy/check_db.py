import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode()
    err = stderr.read().decode()
    return out, err

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD)
    
    try:
        print("=== PostgreSQL Service Status ===")
        out, err = run_command(client, "systemctl status postgresql --no-pager || echo 'Not running'")
        print(out[:500] if out else err[:500])
        
        print("\n=== Database Connection Test ===")
        # Try connecting as postgres user first
        out, err = run_command(client, "sudo -u postgres psql -c 'SELECT 1;' 2>&1")
        print(out if out else err)
        
        print("\n=== Check hoopstats database exists ===")
        out, err = run_command(client, "sudo -u postgres psql -c \"SELECT datname FROM pg_database WHERE datname='hoopstats';\" 2>&1")
        print(out if out else err)
        
        print("\n=== Current .env DATABASE_URL ===")
        out, err = run_command(client, "grep DATABASE_URL /var/www/hoopstats/.env")
        print(out if out else "Not found")
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
