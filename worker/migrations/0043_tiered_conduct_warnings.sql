-- Tiered school behavior policy: warnings are separate from actual score records.
-- Counts belong to each (student, criterion) pair, not to a severity in general.
-- Legacy scored behavior events become initial counted incidents; no retroactive deduction.
CREATE TABLE IF NOT EXISTS behavior_incidents(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 affairs_rule_id INTEGER NOT NULL REFERENCES affairs_behavior_rules(id),
 affairs_category TEXT NOT NULL CHECK(affairs_category IN('good','minor','moderate','serious','very_serious')),
 rule_points INTEGER NOT NULL,
 points_applied INTEGER NOT NULL DEFAULT 0,
 warning_no INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 behavior_record_id INTEGER UNIQUE REFERENCES behavior_records(id),
 source_timetable_id INTEGER REFERENCES timetable(id),
 source_school_date TEXT,
 deleted_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((source_timetable_id IS NULL AND source_school_date IS NULL)
   OR (source_timetable_id IS NOT NULL AND source_school_date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_behavior_incident_counter
 ON behavior_incidents(student_id,affairs_rule_id,deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_behavior_incident_period
 ON behavior_incidents(student_id,source_timetable_id,source_school_date)
 WHERE source_timetable_id IS NOT NULL;

INSERT INTO behavior_incidents(student_id,affairs_rule_id,affairs_category,rule_points,
 points_applied,warning_no,reason,recorded_by,behavior_record_id,
 source_timetable_id,source_school_date,deleted_at,created_at)
SELECT b.student_id,b.affairs_rule_id,b.affairs_category,b.points,
 b.points,0,b.reason,b.recorded_by,b.id,l.timetable_id,l.school_date,b.deleted_at,b.created_at
FROM behavior_records b
LEFT JOIN truancy_behavior_links l ON l.behavior_record_id=b.id
WHERE b.affairs_rule_id IS NOT NULL
 AND b.affairs_category IN('good','minor','moderate','serious','very_serious')
 AND NOT EXISTS(SELECT 1 FROM behavior_incidents i WHERE i.behavior_record_id=b.id);

-- The incident is authoritative; score is inserted only when points_applied != 0.
CREATE TRIGGER IF NOT EXISTS behavior_incident_apply
AFTER INSERT ON behavior_incidents
BEGIN
 INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
 SELECT NEW.student_id,NEW.points_applied,NEW.reason,NEW.recorded_by,NEW.affairs_rule_id,NEW.affairs_category
 WHERE NEW.points_applied<>0;
 UPDATE behavior_incidents SET behavior_record_id=last_insert_rowid()
 WHERE id=NEW.id AND NEW.points_applied<>0;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(NEW.recorded_by,CASE WHEN NEW.points_applied=0 THEN 'affairs_conduct_warned'
 ELSE 'affairs_behavior_recorded' END,'behavior_incidents',CAST(NEW.id AS TEXT));
END;

-- Removing an actual score record also retires the counted incident.
CREATE TRIGGER IF NOT EXISTS behavior_incident_record_deleted
AFTER UPDATE OF deleted_at ON behavior_records
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
 UPDATE behavior_incidents SET deleted_at=NEW.deleted_at
 WHERE behavior_record_id=NEW.id AND deleted_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS behavior_incident_record_restored
AFTER UPDATE OF deleted_at ON behavior_records
WHEN OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL
BEGIN
 UPDATE behavior_incidents SET deleted_at=NULL
 WHERE behavior_record_id=NEW.id AND deleted_at IS NOT NULL;
END;

-- Attendance classified as truancy is still automatically recorded. It follows
-- the same per-student/per-rule threshold as manual misconduct (including late
-- reclassification without double-counting). Its original correction trigger
-- remains responsible for cancelling any linked score.
DROP TRIGGER IF EXISTS truancy_auto_score_on_insert;
DROP TRIGGER IF EXISTS truancy_auto_score_on_delete;

CREATE TRIGGER truancy_auto_score_on_insert AFTER INSERT ON period_truancy
BEGIN
 -- Restore the same prior event when a teacher corrects truancy back again.
 UPDATE behavior_incidents SET deleted_at=NULL
 WHERE student_id=NEW.student_id AND source_timetable_id=NEW.timetable_id
  AND source_school_date=NEW.school_date AND deleted_at IS NOT NULL;
 UPDATE behavior_records SET deleted_at=NULL,deleted_by=NULL,recorded_by=NEW.recorded_by
 WHERE id=(SELECT behavior_record_id FROM behavior_incidents
  WHERE student_id=NEW.student_id AND source_timetable_id=NEW.timetable_id
   AND source_school_date=NEW.school_date)
 AND deleted_at IS NOT NULL;

 -- A new lesson is a new incident (one per date/lesson); thresholds apply.
 INSERT INTO behavior_incidents(student_id,affairs_rule_id,affairs_category,
  rule_points,points_applied,warning_no,reason,recorded_by,source_timetable_id,source_school_date)
 SELECT NEW.student_id,r.id,r.category,r.points,
  CASE WHEN (r.category='minor' AND previous.n<2) OR
            (r.category='moderate' AND previous.n<1) THEN 0 ELSE r.points END,
  CASE WHEN (r.category='minor' AND previous.n<2) OR
            (r.category='moderate' AND previous.n<1) THEN previous.n+1 ELSE 0 END,
  'หนีเรียนในแต่ละคาบเรียน วันที่ '||NEW.school_date||' คาบ '||
   CAST(t.period AS TEXT)||
   CASE WHEN COALESCE(t.end_period,t.period)>t.period
     THEN '-'||CAST(t.end_period AS TEXT) ELSE '' END,
  NEW.recorded_by,NEW.timetable_id,NEW.school_date
 FROM truancy_score_policy p
 JOIN affairs_behavior_rules r ON r.id=p.rule_id
 JOIN timetable t ON t.id=NEW.timetable_id
 CROSS JOIN (SELECT COUNT(*) AS n FROM behavior_incidents i
    WHERE i.student_id=NEW.student_id
      AND i.affairs_rule_id=(SELECT rule_id FROM truancy_score_policy WHERE id=1)
      AND i.deleted_at IS NULL) previous
 WHERE p.id=1 AND NOT EXISTS(
  SELECT 1 FROM behavior_incidents i
  WHERE i.student_id=NEW.student_id AND i.source_timetable_id=NEW.timetable_id
   AND i.source_school_date=NEW.school_date
 );

 -- Keep existing link table for scored truancy so prior deletion protection works.
 INSERT INTO truancy_behavior_links(student_id,timetable_id,school_date,behavior_record_id)
 SELECT NEW.student_id,NEW.timetable_id,NEW.school_date,i.behavior_record_id
 FROM behavior_incidents i
 WHERE i.student_id=NEW.student_id AND i.source_timetable_id=NEW.timetable_id
  AND i.source_school_date=NEW.school_date AND i.behavior_record_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM truancy_behavior_links l WHERE
   l.student_id=NEW.student_id AND l.timetable_id=NEW.timetable_id
   AND l.school_date=NEW.school_date);
END;

CREATE TRIGGER truancy_auto_score_on_delete AFTER DELETE ON period_truancy
BEGIN
 UPDATE behavior_records SET deleted_at=CURRENT_TIMESTAMP,deleted_by=NULL
 WHERE id=(SELECT behavior_record_id FROM behavior_incidents
  WHERE student_id=OLD.student_id AND source_timetable_id=OLD.timetable_id
   AND source_school_date=OLD.school_date)
 AND deleted_at IS NULL;
 UPDATE behavior_incidents SET deleted_at=CURRENT_TIMESTAMP
 WHERE student_id=OLD.student_id AND source_timetable_id=OLD.timetable_id
  AND source_school_date=OLD.school_date AND deleted_at IS NULL;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 SELECT NULL,'truancy_auto_score_reversed','behavior_incidents',CAST(i.id AS TEXT)
 FROM behavior_incidents i WHERE i.student_id=OLD.student_id
 AND i.source_timetable_id=OLD.timetable_id AND i.source_school_date=OLD.school_date;
END;
