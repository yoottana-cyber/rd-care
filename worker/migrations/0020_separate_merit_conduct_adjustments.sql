-- Separate reward points from outstanding behavioral violations without deleting past records.
-- Prior positive records with no category count as merits; only explicit positive
-- adjustment records may reduce behavioral-violation points.
CREATE TABLE IF NOT EXISTS affairs_adjustment_rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 50),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 updated_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_affairs_adjustment_rules_active ON affairs_adjustment_rules(active);
ALTER TABLE behavior_records ADD COLUMN adjustment_rule_id INTEGER REFERENCES affairs_adjustment_rules(id);
CREATE INDEX IF NOT EXISTS idx_behavior_affairs_student ON behavior_records(student_id,affairs_category,created_at);
-- No default 5 or 10 point rules: Student Affairs must explicitly define and approve them.
