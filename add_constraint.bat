@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec hoopstats-db psql -U hoopstats_user -d hoopstats -c "ALTER TABLE player_on_off_splits ADD CONSTRAINT player_on_off_splits_unique UNIQUE (player_id, without_player_id, season);"
