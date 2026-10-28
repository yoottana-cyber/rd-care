-- Never erase educational scoring evidence. Deleted scores are excluded from live totals,
-- student history and guardian portal views, while audit records remain intact.
ALTER TABLE behavior_records ADD COLUMN deleted_at TEXT;
ALTER TABLE behavior_records ADD COLUMN deleted_by INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_behavior_active_student
 ON behavior_records(student_id,deleted_at,created_at);