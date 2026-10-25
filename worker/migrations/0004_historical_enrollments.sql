-- Append-only classroom membership periods (end_date is exclusive).
-- Migration backfills all pre-existing students before any transfer is permitted.
CREATE TABLE student_enrollments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 roll_no INTEGER NOT NULL CHECK(roll_no BETWEEN 1 AND 100),
 start_date TEXT NOT NULL CHECK(length(start_date)=10),
 end_date TEXT CHECK(end_date IS NULL OR (length(end_date)=10 AND end_date>start_date)),
 changed_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,start_date)
);
CREATE UNIQUE INDEX uq_student_current_enrollment ON student_enrollments(student_id) WHERE end_date IS NULL;
CREATE UNIQUE INDEX uq_room_current_roll ON student_enrollments(classroom_id,roll_no) WHERE end_date IS NULL;
CREATE INDEX idx_enrollment_dates ON student_enrollments(classroom_id,start_date,end_date);
INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date)
SELECT id,classroom_id,roll_no,'1900-01-01' FROM students;

-- Transfer plans in v0003 intentionally lack an 'applied' state.
-- Keep their original record and record the action separately.
CREATE TABLE student_transfer_applications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 plan_id INTEGER NOT NULL UNIQUE REFERENCES student_transfer_plans(id),
 student_id INTEGER NOT NULL REFERENCES students(id),
 from_classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 to_classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 old_roll_no INTEGER NOT NULL,
 new_roll_no INTEGER NOT NULL,
 effective_date TEXT NOT NULL,
 executed_by INTEGER NOT NULL REFERENCES users(id),
 executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_transfer_applications_student ON student_transfer_applications(student_id,effective_date);
