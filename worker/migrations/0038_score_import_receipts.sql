-- Exactly-once per file-row for resumed Excel misconduct/merit imports.
-- No change to normal behavior_records or scores: only approved active rules.
CREATE TABLE IF NOT EXISTS score_import_receipts (
 import_id TEXT NOT NULL,
 row_no INTEGER NOT NULL CHECK(row_no BETWEEN 2 AND 100000),
 actor_id INTEGER NOT NULL REFERENCES users(id),
 mode TEXT NOT NULL CHECK(mode IN ('behavior','good')),
 student_id INTEGER NOT NULL REFERENCES students(id),
 rule_id INTEGER NOT NULL REFERENCES affairs_behavior_rules(id),
 reason TEXT NOT NULL,
 behavior_record_id INTEGER REFERENCES behavior_records(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(import_id,row_no)
);
CREATE INDEX IF NOT EXISTS idx_score_import_actor ON score_import_receipts(actor_id,created_at);
