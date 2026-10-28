-- Optional school-day recess settings. Defaults keep the existing continuous
-- 50/45/40 minute lesson clock identical until an administrator enables a break.
-- No timetable, attendance, late QR or historical teaching record is modified.
ALTER TABLE school_settings ADD COLUMN lunch_after_period INTEGER NOT NULL DEFAULT 0
 CHECK(lunch_after_period BETWEEN 0 AND 9);
ALTER TABLE school_settings ADD COLUMN lunch_break_minutes INTEGER NOT NULL DEFAULT 0
 CHECK(lunch_break_minutes=0 OR lunch_break_minutes BETWEEN 15 AND 180);
ALTER TABLE school_settings ADD COLUMN between_period_break_minutes INTEGER NOT NULL DEFAULT 0
 CHECK(between_period_break_minutes BETWEEN 0 AND 30);
