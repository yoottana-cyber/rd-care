-- v0026: add concurrency-safe collision detection without rebuilding the
-- timetable table or changing any timetable IDs referenced by period attendance.
-- Old timetable entries are untouched; the audit screen reports legacy clashes.
CREATE TRIGGER IF NOT EXISTS timetable_clash_insert
BEFORE INSERT ON timetable
WHEN NEW.active=1
BEGIN
 SELECT RAISE(ABORT,'TIMETABLE_OVERLAP')
 WHERE EXISTS(
  SELECT 1 FROM timetable t WHERE t.active=1
   AND t.day_of_week=NEW.day_of_week
   AND (t.classroom_id=NEW.classroom_id OR t.teacher_user_id=NEW.teacher_user_id)
   AND t.period<=COALESCE(NEW.end_period,NEW.period)
   AND COALESCE(t.end_period,t.period)>=NEW.period
 );
END;

CREATE TRIGGER IF NOT EXISTS timetable_clash_update
BEFORE UPDATE OF classroom_id,teacher_user_id,day_of_week,period,end_period,active
 ON timetable
WHEN NEW.active=1
BEGIN
 SELECT RAISE(ABORT,'TIMETABLE_OVERLAP')
 WHERE EXISTS(
  SELECT 1 FROM timetable t WHERE t.id<>OLD.id AND t.active=1
   AND t.day_of_week=NEW.day_of_week
   AND (t.classroom_id=NEW.classroom_id OR t.teacher_user_id=NEW.teacher_user_id)
   AND t.period<=COALESCE(NEW.end_period,NEW.period)
   AND COALESCE(t.end_period,t.period)>=NEW.period
 );
END;
