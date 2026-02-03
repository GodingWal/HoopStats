import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def create_ssh_client():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    return client

def run_command(client, command, timeout=120):
    print(f"Running: {command}")
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Stderr:\n{err}")
    return exit_status == 0

def main():
    client = create_ssh_client()
    
    print("Fixing Nginx installation...")
    
    # Clean up any partial install and reinstall
    run_command(client, "apt-get remove -y nginx nginx-common nginx-full 2>/dev/null || true")
    run_command(client, "apt-get autoremove -y")
    run_command(client, "apt-get update -y")
    run_command(client, "apt-get install -y nginx")
    run_command(client, "systemctl enable nginx")
    
    # Configure Nginx
    nginx_config = '''server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}'''
    
    run_command(client, f"""cat > /etc/nginx/sites-available/hoopstats << 'EOF'
{nginx_config}
EOF""")
    
    run_command(client, "ln -sf /etc/nginx/sites-available/hoopstats /etc/nginx/sites-enabled/")
    run_command(client, "rm -f /etc/nginx/sites-enabled/default")
    run_command(client, "nginx -t")
    run_command(client, "systemctl start nginx")
    run_command(client, "systemctl status nginx --no-pager")
    
    # Final verification
    print("\nTesting access via port 80...")
    run_command(client, "curl -s http://localhost/api/health")
    
    client.close()
    print("\nNginx setup complete!")

if __name__ == "__main__":
    main()
