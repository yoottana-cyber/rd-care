-- Keep school attendance and disciplinary audit history while removing identities
-- from active management. Do not physically cascade historical educational records.
ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE students ADD COLUMN deleted_at TEXT;
CREATE INDEX IF NOT EXISTS idx_users_deleted_at ON users(deleted_at);
CREATE INDEX IF NOT EXISTS idx_students_deleted_at ON students(deleted_at);
