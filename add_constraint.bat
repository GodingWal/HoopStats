@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec courtside-edge-db psql -U courtside_edge_user -d courtside_edge -c "ALTER TABLE player_on_off_splits ADD CONSTRAINT player_on_off_splits_unique UNIQUE (player_id, without_player_id, season);"
