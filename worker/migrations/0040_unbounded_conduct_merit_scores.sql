-- RD CONNECT: school-approved merit and misconduct criteria no longer have
-- an artificial +/-50 score cap. Preserve all row IDs, history and associations.
-- Cloudflare D1 enforces foreign keys even inside migrations. Defer checks during
-- the two SQLite table rebuilds, then re-enable validation BEFORE commit.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE affairs_behavior_rules_unbounded (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN('good','minor','moderate','serious','very_serious')),
 points INTEGER NOT NULL CHECK(points!=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 updated_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((category='good' AND points>0) OR (category!='good' AND points<0))
);

INSERT INTO affairs_behavior_rules_unbounded
 (id,name,category,points,active,updated_by,created_at,updated_at)
 SELECT id,name,category,points,active,updated_by,created_at,updated_at
 FROM affairs_behavior_rules;

DROP TABLE affairs_behavior_rules;
ALTER TABLE affairs_behavior_rules_unbounded RENAME TO affairs_behavior_rules;
CREATE INDEX idx_affairs_rules_category ON affairs_behavior_rules(category,active);

CREATE TABLE behavior_records_unbounded (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 points INTEGER NOT NULL CHECK(points!=0),
 reason TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 affairs_rule_id INTEGER REFERENCES affairs_behavior_rules(id),
 affairs_category TEXT CHECK(affairs_category IS NULL OR affairs_category IN('good','minor','moderate','serious','very_serious','adjustment')),
 adjustment_rule_id INTEGER REFERENCES affairs_adjustment_rules(id),
 deleted_at TEXT,
 deleted_by INTEGER REFERENCES users(id)
);

INSERT INTO behavior_records_unbounded
 (id,student_id,points,reason,recorded_by,created_at,affairs_rule_id,affairs_category,
  adjustment_rule_id,deleted_at,deleted_by)
 SELECT id,student_id,points,reason,recorded_by,created_at,affairs_rule_id,affairs_category,
  adjustment_rule_id,deleted_at,deleted_by
 FROM behavior_records;

DROP TABLE behavior_records;
ALTER TABLE behavior_records_unbounded RENAME TO behavior_records;
CREATE INDEX idx_behavior_student ON behavior_records(student_id,created_at);
CREATE INDEX idx_behavior_affairs_student ON behavior_records(student_id,affairs_category,created_at);
CREATE INDEX idx_behavior_active_student ON behavior_records(student_id,deleted_at,created_at);

-- All foreign references (including truancy links and historical import receipts)
-- now resolve to tables with their ORIGINAL names and ORIGINAL integer IDs.
-- Re-enabling checks clears deferred DROP TABLE violations once all rows exist.
PRAGMA defer_foreign_keys = OFF;
