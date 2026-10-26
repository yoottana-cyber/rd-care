-- Teachers may propose classes, but only approved timetables grant student-roster access.
-- Existing admin-created and historical lessons remain approved.
ALTER TABLE timetable ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
 CHECK(approval_status IN ('pending','approved','rejected','archived'));
ALTER TABLE timetable ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE timetable ADD COLUMN reviewed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_timetable_approval ON timetable(approval_status,day_of_week);
