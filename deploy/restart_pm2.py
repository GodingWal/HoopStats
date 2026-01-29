import paramiko
import sys
import time

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def run_command(client, cmd, silent=False):
    stdin, stdout, stderr = client.exec_command(cmd)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    if not silent:
        if out:
            print(out[:800])
        if err:
            print(f"Err: {err[:500]}")
    return exit_status == 0, out

def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USERNAME, password=PASSWORD)
    
    try:
        # Create ecosystem file that loads env from .env
        ecosystem_content = '''module.exports = {
  apps: [{
    name: 'hoopstats',
    script: 'dist/index.cjs',
    cwd: '/var/www/hoopstats',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    node_args: '-r dotenv/config'
  }]
};'''
        
        print("1. Creating ecosystem.config.js...")
        # Write ecosystem file
        sftp = client.open_sftp()
        with sftp.file('/var/www/hoopstats/ecosystem.config.js', 'w') as f:
            f.write(ecosystem_content)
        sftp.close()
        print("   Done")
        
        print("2. Creating dotenv loader wrapper...")
        # Create a wrapper script that sources .env
        wrapper = '''#!/bin/bash
cd /var/www/hoopstats
export $(grep -v '^#' .env | xargs)
exec node dist/index.cjs
'''
        sftp = client.open_sftp()
        with sftp.file('/var/www/hoopstats/start.sh', 'w') as f:
            f.write(wrapper)
        sftp.close()
        run_command(client, "chmod +x /var/www/hoopstats/start.sh", silent=True)
        print("   Done")
        
        print("3. Starting PM2 with wrapper script...")
        run_command(client, "cd /var/www/hoopstats && pm2 start start.sh --name hoopstats")
        
        print("4. Waiting for startup...")
        time.sleep(5)
        
        print("5. Checking status...")
        run_command(client, "pm2 status hoopstats")
        
        print("6. Checking logs for DB connection...")
        stdin, stdout, stderr = client.exec_command("pm2 logs hoopstats --lines 15 --nostream 2>/dev/null | grep -i 'database\\|db\\|error\\|started' | head -10")
        print(stdout.read().decode())
        
        print("7. Saving PM2 list for restart persistence...")
        run_command(client, "pm2 save --force", silent=True)
        
    finally:
        client.close()

if __name__ == "__main__":
    main()
