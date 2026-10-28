-- School day class-period settings. Keep attendance, timetable and existing
-- school settings untouched; no historical attendance is recalculated.
-- The first period is independent of school opening/late QR cutoff time.
ALTER TABLE school_settings ADD COLUMN first_period_start_time TEXT NOT NULL DEFAULT '08:30'
 CHECK(length(first_period_start_time)=5 AND first_period_start_time GLOB '[0-2][0-9]:[0-5][0-9]');
ALTER TABLE school_settings ADD COLUMN period_duration_minutes INTEGER NOT NULL DEFAULT 50
 CHECK(period_duration_minutes IN (40,45,50));
