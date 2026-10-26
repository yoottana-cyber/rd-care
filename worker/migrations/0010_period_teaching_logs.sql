-- A teaching note is optional, keyed by the actual dated teaching session.
-- Keep the field separate from per-student attendance so omitted notes create no log.
CREATE TABLE IF NOT EXISTS period_teaching_logs (
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,
 note TEXT NOT NULL CHECK(length(note)<=2000),
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(timetable_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_teaching_logs_date ON period_teaching_logs(school_date,timetable_id);
