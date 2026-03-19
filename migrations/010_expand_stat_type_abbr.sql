-- Expand stat_type_abbr columns from varchar(10) to varchar(20)
-- to accommodate unmapped PrizePicks stat types and combo bets

ALTER TABLE prizepicks_lines ALTER COLUMN stat_type_abbr TYPE varchar(20);
ALTER TABLE prizepicks_line_movements ALTER COLUMN stat_type_abbr TYPE varchar(20);
ALTER TABLE prizepicks_daily_lines ALTER COLUMN stat_type_abbr TYPE varchar(20);
