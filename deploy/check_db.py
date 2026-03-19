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
    print("CHECKING DATABASE FOR PRIZEPICKS DATA")
    print("="*60)
    
    # Check if there are PrizePicks lines in the database
    print("\n[1] Checking PrizePicks lines in database...")
    run_command(client, """
        sudo -u postgres psql -d courtsideedge -c "SELECT COUNT(*) as total_lines, MAX(captured_at) as last_capture FROM prizepicks_lines;"
    """)
    
    # Show some sample lines
    print("\n[2] Sample PrizePicks lines...")
    run_command(client, """
        sudo -u postgres psql -d courtsideedge -c "SELECT player_name, stat_type, line_value, captured_at FROM prizepicks_lines ORDER BY captured_at DESC LIMIT 10;"
    """)
    
    # Check the table structure
    print("\n[3] PrizePicks lines table structure...")
    run_command(client, """
        sudo -u postgres psql -d courtsideedge -c "\\d prizepicks_lines" 2>/dev/null || echo "Table may not exist"
    """)
    
    client.close()
    print("\n" + "="*60)
    print("CHECK COMPLETE")
    print("="*60)

if __name__ == "__main__":
    main()
