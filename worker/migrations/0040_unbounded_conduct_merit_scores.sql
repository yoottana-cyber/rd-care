-- RD CONNECT: school-approved merit and misconduct criteria no longer have
-- an artificial +/-50 score cap. Preserve all row IDs, history and associations.
-- Cloudflare D1 enforces foreign keys even inside migrations. Defer checks during
-- the two SQLite table rebuilds, then re-enable validation BEFORE commit.
PRAGMA defer_foreign_keys = ON;

-- Drop triggers attached to period_truancy that reference behavior_records;
-- SQLite checks trigger SQL while renaming a rebuilt table.
DROP TRIGGER IF EXISTS truancy_auto_score_on_insert;
DROP TRIGGER IF EXISTS truancy_auto_score_on_delete;

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
-- Recreate original truancy triggers without modifying their -10 policy.
CREATE TRIGGER IF NOT EXISTS truancy_auto_score_on_insert
AFTER INSERT ON period_truancy
BEGIN
 -- Reactivation after a corrected status returns to truancy restores the same
 -- soft-deleted deduction rather than creating a second -10 score.
 UPDATE behavior_records
 SET deleted_at=NULL,deleted_by=NULL,recorded_by=NEW.recorded_by
 WHERE id=(SELECT behavior_record_id FROM truancy_behavior_links
    WHERE student_id=NEW.student_id AND timetable_id=NEW.timetable_id
      AND school_date=NEW.school_date)
 AND deleted_at IS NOT NULL;

 -- Initial classification: insert a -10 violation tied to the approved rule.
 INSERT INTO behavior_records
  (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
 SELECT NEW.student_id,-10,
  'หนีเรียน วันที่ '||NEW.school_date||' คาบ '||
   (SELECT CAST(t.period AS TEXT)||
     CASE WHEN COALESCE(t.end_period,t.period)>t.period
      THEN '-'||CAST(t.end_period AS TEXT) ELSE '' END
    FROM timetable t WHERE t.id=NEW.timetable_id),
  NEW.recorded_by,p.rule_id,'moderate'
 FROM truancy_score_policy p WHERE p.id=1
 AND NOT EXISTS (
  SELECT 1 FROM truancy_behavior_links l
  WHERE l.student_id=NEW.student_id AND l.timetable_id=NEW.timetable_id
    AND l.school_date=NEW.school_date
 );

 INSERT INTO truancy_behavior_links
  (student_id,timetable_id,school_date,behavior_record_id)
 SELECT NEW.student_id,NEW.timetable_id,NEW.school_date,last_insert_rowid()
 WHERE NOT EXISTS (
  SELECT 1 FROM truancy_behavior_links l
  WHERE l.student_id=NEW.student_id AND l.timetable_id=NEW.timetable_id
    AND l.school_date=NEW.school_date
 );

 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 SELECT NEW.recorded_by,'truancy_auto_score_applied','behavior_records',
  CAST(l.behavior_record_id AS TEXT)
 FROM truancy_behavior_links l
 WHERE l.student_id=NEW.student_id AND l.timetable_id=NEW.timetable_id
   AND l.school_date=NEW.school_date;
END;

CREATE TRIGGER IF NOT EXISTS truancy_auto_score_on_delete
AFTER DELETE ON period_truancy
BEGIN
 -- The attendance correction revokes the deduction. No permanent delete.
 UPDATE behavior_records
 SET deleted_at=CURRENT_TIMESTAMP,deleted_by=NULL
 WHERE id=(SELECT behavior_record_id FROM truancy_behavior_links
  WHERE student_id=OLD.student_id AND timetable_id=OLD.timetable_id
   AND school_date=OLD.school_date)
 AND deleted_at IS NULL;

 -- No actor guessed: the attendance_saved audit identifies who corrected it.
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 SELECT NULL,'truancy_auto_score_reversed','behavior_records',
  CAST(l.behavior_record_id AS TEXT)
 FROM truancy_behavior_links l
 WHERE l.student_id=OLD.student_id AND l.timetable_id=OLD.timetable_id
  AND l.school_date=OLD.school_date;
END;

-- Re-enabling checks clears deferred DROP TABLE violations once all rows exist.
PRAGMA defer_foreign_keys = OFF;
