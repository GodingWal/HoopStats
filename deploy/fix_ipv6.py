import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, command, timeout=60):
    print(f"\nRunning: {command}")
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
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {HOST}...")
    client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
    print("Connected!")
    
    print("\n" + "="*60)
    print("FIXING NGINX IPv6 PROXY ISSUE")
    print("="*60)
    
    # Create nginx config that explicitly uses IPv4
    nginx_config = '''# Upstream to force IPv4
upstream hoopstats_backend {
    server 127.0.0.1:5000;
}

server {
    listen 80;
    listen [::]:80;
    server_name courtside-edge.com www.courtside-edge.com _;

    location / {
        proxy_pass http://hoopstats_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}'''
    
    print("\n[1] Writing new nginx config with explicit IPv4 upstream...")
    run_command(client, f"""cat > /etc/nginx/sites-available/hoopstats << 'EOF'
{nginx_config}
EOF""")
    
    print("\n[2] Testing nginx config...")
    run_command(client, "nginx -t")
    
    print("\n[3] Reloading nginx...")
    run_command(client, "systemctl reload nginx")
    
    import time
    time.sleep(2)
    
    print("\n[4] Testing with Host header for domain:")
    run_command(client, "curl -s -H 'Host: courtside-edge.com' http://127.0.0.1/api/health")
    
    print("\n[5] Checking nginx error log:")
    run_command(client, "tail -5 /var/log/nginx/error.log")
    
    client.close()
    print("\n" + "="*60)
    print("FIX APPLIED - TRY http://courtside-edge.com NOW")
    print("="*60)

if __name__ == "__main__":
    main()
