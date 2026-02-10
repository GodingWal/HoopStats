import paramiko
import json
import time

HOST = "76.13.100.125"
USERNAME = "root"
PASSWORD = "Wittymango520@"

def main():
    print(f"Connecting to {HOST}...")
    try:
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(HOST, username=USERNAME, password=PASSWORD, timeout=30)
        
        print("=== Checking PrizePicks Data ===")
        # Curl the endpoint
        cmd = "curl -s http://localhost:3000/api/ref-signal/prizepicks"
        stdin, stdout, stderr = client.exec_command(cmd)
        
        output = stdout.read().decode()
        err = stderr.read().decode()
        
        if output:
            try:
                data = json.loads(output)
                projections = data.get('projections', [])
                count = data.get('count', 0)
                print(f"Count: {count}")
                
                if count > 0:
                    stat_types = set()
                    for p in projections:
                        stat_types.add(p.get('statType', 'UNKNOWN'))
                    
                    print(f"Unique Stat Types: {sorted(list(stat_types))}")
                    
                    # check for fouls
                    fouls = [p for p in projections if 'foul' in p.get('statType', '').lower()]
                    print(f"Fouls projections: {len(fouls)}")
                    if len(fouls) > 0:
                        print(f"Sample Foul: {fouls[0]}")
                else:
                    print("No projections returned.")
                    if 'error' in data:
                        print(f"Error in response: {data['error']}")
            except json.JSONDecodeError:
                print(f"Failed to parse JSON. Output start: {output[:100]}")
        else:
            print("No output from curl.")
            if err:
                print(f"Stderr: {err}")

        client.close()
        
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    main()
