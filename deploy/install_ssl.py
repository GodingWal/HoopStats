
import paramiko
import sys
import time

# Fix for Windows Unicode output
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"
DOMAIN = "courtside-edge.com"
EMAIL = "admin@courtside-edge.com"

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
    
    # Wait for command to finish
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    
    if out:
        print(f"Output:\n{out}")
    if err:
        print(f"Error:\n{err}")
        
    return exit_status == 0

def main():
    client = create_ssh_client()
    try:
        print("Checking for Certbot...")
        # Check if certbot is installed
        if not run_command(client, "which certbot"):
            print("Certbot not found. Installing...")
            run_command(client, "apt-get update")
            run_command(client, "apt-get install -y certbot python3-certbot-nginx")
        else:
            print("Certbot is already installed.")

        # Run Certbot
        print(f"Obtaining SSL certificate for {DOMAIN}...")
        # non-interactive, agree to TOS, email, nginx plugin, domains, redirect http to https
        cmd = f"certbot --nginx -d {DOMAIN} -d www.{DOMAIN} --non-interactive --agree-tos -m {EMAIL} --redirect"
        if run_command(client, cmd):
            print("SSL Certificate installed successfully.")
        else:
            print("Failed to install SSL certificate. Ensure DNS is pointing to this server.")

        # Test Nginx config
        run_command(client, "nginx -t")
        
        # Reload Nginx
        run_command(client, "systemctl reload nginx")

    finally:
        client.close()

if __name__ == "__main__":
    main()
