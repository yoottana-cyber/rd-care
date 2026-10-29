-- Secondary homeroom advisor; keep the original advisor_user_id and all existing classroom assignments intact.
ALTER TABLE classrooms ADD COLUMN advisor2_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_classrooms_advisor2 ON classrooms(advisor2_user_id);
