-- Imports of SCHOOL SCORE CRITERIA (not student score records).
-- A receipt allows retrying a timed-out chunk without inserting duplicate rules.
-- Migration 0038 from the preceding student-score feature remains for history.
CREATE TABLE IF NOT EXISTS affairs_criteria_import_receipts (
 import_id TEXT NOT NULL,
 row_no INTEGER NOT NULL CHECK(row_no >= 2),
 actor_id INTEGER NOT NULL REFERENCES users(id),
 mode TEXT NOT NULL CHECK(mode IN ('behavior','good')),
 input_rule_id INTEGER,
 rule_id INTEGER NOT NULL REFERENCES affairs_behavior_rules(id),
 category TEXT NOT NULL CHECK(category IN ('good','minor','moderate','serious','very_serious')),
 name TEXT NOT NULL,
 points INTEGER NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(import_id,row_no)
);
CREATE INDEX IF NOT EXISTS idx_affairs_criteria_import_actor
 ON affairs_criteria_import_receipts(actor_id,created_at);
