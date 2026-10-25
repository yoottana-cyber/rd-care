-- Plans only. A plan MUST NOT change the current student roster:
-- the attendance model still resolves old records through students.classroom_id.
CREATE TABLE IF NOT EXISTS student_transfer_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
  to_classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
  school_year INTEGER NOT NULL CHECK(school_year BETWEEN 2500 AND 2700),
  term INTEGER NOT NULL CHECK(term IN (1,2)),
  state TEXT NOT NULL DEFAULT 'planned' CHECK(state IN ('planned','cancelled')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(from_classroom_id != to_classroom_id),
  UNIQUE(student_id,school_year,term)
);
CREATE INDEX IF NOT EXISTS idx_student_transfer_plans_term ON student_transfer_plans(school_year,term,state);
