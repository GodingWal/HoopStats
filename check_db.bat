@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec courtside-edge-db psql -U courtside_edge_user -d courtside_edge -c "SELECT indexname FROM pg_indexes WHERE tablename = 'player_on_off_splits';"
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec courtside-edge-db psql -U courtside_edge_user -d courtside_edge -c "SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'player_on_off_splits';"
