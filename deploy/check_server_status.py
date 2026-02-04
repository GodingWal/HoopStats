import paramiko
import sys

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)

print("--- PM2 List ---")
stdin, stdout, stderr = client.exec_command("pm2 list")
print(stdout.read().decode())

print("--- Port 3000 ---")
stdin, stdout, stderr = client.exec_command("netstat -tuln | grep 3000")
print(stdout.read().decode())

print("--- App Logs (Tail) ---")
stdin, stdout, stderr = client.exec_command("pm2 logs --lines 20 --nostream")
print(stdout.read().decode())

client.close()
