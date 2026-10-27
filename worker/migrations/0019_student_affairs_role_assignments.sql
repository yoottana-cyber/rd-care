-- An explicit Student Affairs assignment for existing teachers.
-- Keep the teacher's teaching/advisor role unchanged. Historical staff-role accounts
-- were already explicitly created as Student Affairs and remain eligible.
-- Admins manage the assignment but do not receive Student Affairs access by default.
CREATE TABLE IF NOT EXISTS student_affairs_assignments (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_affairs_assigned_by
 ON student_affairs_assignments(assigned_by);
