-- Allow admin-selectable warning Push without changing existing deductions.
-- Initially OFF, preserving the previous no-warning-notification behavior.
INSERT OR IGNORE INTO notification_preferences(event_key,enabled) VALUES
 ('warning_student',0),('warning_guardian',0);

-- Reuse the existing per-incident delivery ledger; an incident can be
-- a warning OR a deduction, never both.
CREATE TRIGGER IF NOT EXISTS behavior_warning_notification_on_insert
 AFTER INSERT ON behavior_incidents
 WHEN NEW.points_applied=0 AND NEW.warning_no>0
  AND NEW.affairs_category IN ('minor','moderate') AND NEW.deleted_at IS NULL
BEGIN
 INSERT OR IGNORE INTO behavior_score_push_events(incident_id) VALUES(NEW.id);
END;

-- Selected behavior/merit date is recorded separately from the actual creation
-- timestamp. The history date follows the chosen Bangkok calendar day.
ALTER TABLE behavior_incidents ADD COLUMN recorded_school_date TEXT
 CHECK(recorded_school_date IS NULL OR
 (length(recorded_school_date)=10 AND recorded_school_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'));

-- The original behavior_records history must inherit the chosen date so that
-- student/guardian history, scores and staff reports agree.
DROP TRIGGER IF EXISTS behavior_incident_apply;
CREATE TRIGGER behavior_incident_apply AFTER INSERT ON behavior_incidents
BEGIN
 INSERT INTO behavior_records(student_id,points,reason,recorded_by,
  affairs_rule_id,affairs_category,created_at)
 SELECT NEW.student_id,NEW.points_applied,NEW.reason,NEW.recorded_by,
  NEW.affairs_rule_id,NEW.affairs_category,NEW.created_at
 WHERE NEW.points_applied<>0;
 UPDATE behavior_incidents SET behavior_record_id=last_insert_rowid()
 WHERE id=NEW.id AND NEW.points_applied<>0;
 INSERT INTO audit_logs(actor_id,action,entity_type,entity_id)
 VALUES(NEW.recorded_by,CASE WHEN NEW.points_applied=0 THEN 'affairs_conduct_warned'
 ELSE 'affairs_behavior_recorded' END,'behavior_incidents',CAST(NEW.id AS TEXT));
END;
