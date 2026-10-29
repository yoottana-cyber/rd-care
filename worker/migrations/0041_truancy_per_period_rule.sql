-- Route teacher-entered period truancy to the dedicated school misconduct rule.
-- No backfill or score duplication: historical records keep their current references.
-- If staff already imported "หนีเรียนในแต่ละคาบเรียน", use that existing rule.
-- Otherwise rename the existing automatic school rule while preserving its ID.
-- Preserve the original -10 value when renaming; when switching to a staff-
-- configured existing rule, new entries use the points of that selected rule.

-- Retire the earlier generic "หนีเรียน" rule only when switching to a
-- distinct existing, explicitly named per-period criterion.
UPDATE affairs_behavior_rules
 SET active=0,updated_at=CURRENT_TIMESTAMP
 WHERE id=(SELECT rule_id FROM truancy_score_policy WHERE id=1)
 AND EXISTS(
  SELECT 1 FROM affairs_behavior_rules c
  WHERE c.name='หนีเรียนในแต่ละคาบเรียน'
   AND c.category IN('minor','moderate','serious','very_serious')
   AND c.id<>(SELECT rule_id FROM truancy_score_policy WHERE id=1)
 );

UPDATE affairs_behavior_rules
 SET name='หนีเรียนในแต่ละคาบเรียน',updated_at=CURRENT_TIMESTAMP
 WHERE id=(SELECT rule_id FROM truancy_score_policy WHERE id=1)
 AND NOT EXISTS(
  SELECT 1 FROM affairs_behavior_rules c
  WHERE c.name='หนีเรียนในแต่ละคาบเรียน'
   AND c.category IN('minor','moderate','serious','very_serious')
   AND c.id<>(SELECT rule_id FROM truancy_score_policy WHERE id=1)
 );

-- Prefer a matching moderate criterion; otherwise use the first existing
-- misconduct criterion with the requested exact name.
UPDATE truancy_score_policy
 SET rule_id=(
  SELECT id FROM affairs_behavior_rules
  WHERE name='หนีเรียนในแต่ละคาบเรียน'
   AND category IN('minor','moderate','serious','very_serious')
  ORDER BY CASE WHEN category='moderate' THEN 0 ELSE 1 END,id
  LIMIT 1
 )
 WHERE id=1 AND EXISTS(
  SELECT 1 FROM affairs_behavior_rules
  WHERE name='หนีเรียนในแต่ละคาบเรียน'
   AND category IN('minor','moderate','serious','very_serious')
 );
UPDATE affairs_behavior_rules SET active=1,updated_at=CURRENT_TIMESTAMP
 WHERE id=(SELECT rule_id FROM truancy_score_policy WHERE id=1);

-- Change only the insert trigger; the delete/correction trigger remains intact,
-- continuing to restore/revoke the SAME score record on status correction.
DROP TRIGGER IF EXISTS truancy_auto_score_on_insert;
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

 -- Each newly classified period is scored using the school-approved per-period rule.
 INSERT INTO behavior_records
  (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
 SELECT NEW.student_id,r.points,
  'หนีเรียนในแต่ละคาบเรียน วันที่ '||NEW.school_date||' คาบ '||
   (SELECT CAST(t.period AS TEXT)||
     CASE WHEN COALESCE(t.end_period,t.period)>t.period
      THEN '-'||CAST(t.end_period AS TEXT) ELSE '' END
    FROM timetable t WHERE t.id=NEW.timetable_id),
  NEW.recorded_by,p.rule_id,'moderate'
 FROM truancy_score_policy p JOIN affairs_behavior_rules r ON r.id=p.rule_id WHERE p.id=1
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
