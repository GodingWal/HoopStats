@echo off
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec hoopstats-db psql -U hoopstats_user -d hoopstats -c "SELECT indexname FROM pg_indexes WHERE tablename = 'player_on_off_splits';"
"C:\Program Files\Docker\Docker\resources\bin\docker.exe" exec hoopstats-db psql -U hoopstats_user -d hoopstats -c "SELECT constraint_name, constraint_type FROM information_schema.table_constraints WHERE table_name = 'player_on_off_splits';"
