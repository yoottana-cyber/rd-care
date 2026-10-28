-- Automate the school-approved truancy conduct rule. Triggered ONLY by a new
-- period_truancy classification, never by ordinary 'absent' or daily attendance.
-- No backfill: prior attendance remains unchanged and receives no retroactive penalty.
INSERT INTO affairs_behavior_rules(name,category,points,active)
SELECT 'หนีเรียน','moderate',-10,1
WHERE NOT EXISTS (
 SELECT 1 FROM affairs_behavior_rules
 WHERE name='หนีเรียน' AND category='moderate' AND points=-10
);

CREATE TABLE IF NOT EXISTS truancy_score_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 rule_id INTEGER NOT NULL REFERENCES affairs_behavior_rules(id)
);
INSERT OR IGNORE INTO truancy_score_policy(id,rule_id)
SELECT 1,id FROM affairs_behavior_rules
WHERE name='หนีเรียน' AND category='moderate' AND points=-10
ORDER BY id LIMIT 1;

-- One conduct record per student + subject lesson + school day.
-- Keep its ID when attendance is corrected so audit history stays traceable.
CREATE TABLE IF NOT EXISTS truancy_behavior_links (
 student_id INTEGER NOT NULL REFERENCES students(id),
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,
 behavior_record_id INTEGER NOT NULL UNIQUE REFERENCES behavior_records(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,timetable_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_truancy_behavior_record
 ON truancy_behavior_links(behavior_record_id);

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
