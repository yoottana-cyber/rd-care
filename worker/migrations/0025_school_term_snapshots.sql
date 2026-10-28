-- Term-specific, immutable reference snapshots. Do NOT change timetable IDs,
-- attendance foreign keys or historical student enrollment intervals.
CREATE TABLE IF NOT EXISTS school_term_snapshots (
 academic_year INTEGER NOT NULL CHECK (academic_year BETWEEN 2500 AND 2700),
 semester INTEGER NOT NULL CHECK (semester IN (1,2)),
 snapshot_date TEXT NOT NULL,
 semester_start_date TEXT,
 semester_end_date TEXT,
 captured_by INTEGER NOT NULL REFERENCES users(id),
 captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (academic_year,semester)
);
CREATE TABLE IF NOT EXISTS school_term_roster (
 academic_year INTEGER NOT NULL,
 semester INTEGER NOT NULL,
 student_id INTEGER NOT NULL REFERENCES students(id),
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 roll_no INTEGER NOT NULL,
 PRIMARY KEY (academic_year,semester,student_id),
 FOREIGN KEY (academic_year,semester)
  REFERENCES school_term_snapshots(academic_year,semester)
);
CREATE INDEX IF NOT EXISTS idx_term_roster_classroom
 ON school_term_roster(academic_year,semester,classroom_id,roll_no);
CREATE TABLE IF NOT EXISTS school_term_lessons (
 academic_year INTEGER NOT NULL,
 semester INTEGER NOT NULL,
 original_timetable_id INTEGER NOT NULL,
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 teacher_user_id INTEGER NOT NULL REFERENCES users(id),
 day_of_week INTEGER NOT NULL,
 period INTEGER NOT NULL,
 end_period INTEGER NOT NULL,
 subject_code TEXT NOT NULL,
 subject TEXT NOT NULL,
 PRIMARY KEY (academic_year,semester,original_timetable_id),
 FOREIGN KEY (academic_year,semester)
  REFERENCES school_term_snapshots(academic_year,semester)
);
CREATE INDEX IF NOT EXISTS idx_term_lessons_classroom
 ON school_term_lessons(academic_year,semester,classroom_id,day_of_week,period);
