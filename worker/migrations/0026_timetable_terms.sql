-- v0026: keep all timetable IDs and period attendance FKs while removing the
-- legacy cross-semester UNIQUE(classroom_id,day_of_week,period).
-- Cloudflare D1 executes migrations transactionally: defer FK checks until the
-- rebuilt table is installed with the original name and original primary keys.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE timetable_term_rebuild (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 teacher_user_id INTEGER NOT NULL REFERENCES users(id),
 day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
 period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12),
 subject TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 subject_code TEXT NOT NULL DEFAULT '',
 end_period INTEGER CHECK(end_period IS NULL OR end_period BETWEEN 1 AND 12),
 approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK(approval_status IN ('pending','approved','rejected','archived')),
 reviewed_by INTEGER REFERENCES users(id),
 reviewed_at TEXT,
 academic_year INTEGER NOT NULL DEFAULT 2569 CHECK(academic_year BETWEEN 2500 AND 2700),
 semester INTEGER NOT NULL DEFAULT 2 CHECK(semester IN(1,2))
);
INSERT INTO timetable_term_rebuild
 (id,classroom_id,teacher_user_id,day_of_week,period,subject,active,
  subject_code,end_period,approval_status,reviewed_by,reviewed_at,academic_year,semester)
 SELECT id,classroom_id,teacher_user_id,day_of_week,period,subject,active,
  subject_code,end_period,approval_status,reviewed_by,reviewed_at,
  (SELECT academic_year FROM school_settings WHERE id=1),
  (SELECT semester FROM school_settings WHERE id=1)
 FROM timetable;
DROP TABLE timetable;
ALTER TABLE timetable_term_rebuild RENAME TO timetable;
CREATE INDEX idx_timetable_teacher ON timetable(teacher_user_id,day_of_week,active);
CREATE INDEX idx_timetable_room_week ON timetable(classroom_id,day_of_week,active,period);
CREATE INDEX idx_timetable_teacher_week ON timetable(teacher_user_id,day_of_week,active,period);
CREATE INDEX idx_timetable_approval ON timetable(approval_status,day_of_week);
CREATE INDEX idx_timetable_term_room ON timetable(academic_year,semester,classroom_id,day_of_week,period,active);
CREATE INDEX idx_timetable_term_teacher ON timetable(academic_year,semester,teacher_user_id,day_of_week,period,active);

-- Database-level safeguards against simultaneous writers: teachers can add
-- lessons immediately, but never double-book a room or a teacher in a term.
CREATE TRIGGER timetable_term_no_overlap_insert
BEFORE INSERT ON timetable
WHEN NEW.active=1
BEGIN
 SELECT RAISE(ABORT,'TIMETABLE_OVERLAP')
 WHERE EXISTS (
  SELECT 1 FROM timetable t WHERE t.active=1
   AND t.academic_year=NEW.academic_year AND t.semester=NEW.semester
   AND t.day_of_week=NEW.day_of_week
   AND (t.classroom_id=NEW.classroom_id OR t.teacher_user_id=NEW.teacher_user_id)
   AND t.period<=COALESCE(NEW.end_period,NEW.period)
   AND COALESCE(t.end_period,t.period)>=NEW.period
 );
END;
CREATE TRIGGER timetable_term_no_overlap_update
BEFORE UPDATE OF classroom_id,teacher_user_id,day_of_week,period,end_period,active,academic_year,semester
ON timetable
WHEN NEW.active=1
BEGIN
 SELECT RAISE(ABORT,'TIMETABLE_OVERLAP')
 WHERE EXISTS (
  SELECT 1 FROM timetable t WHERE t.id<>OLD.id AND t.active=1
   AND t.academic_year=NEW.academic_year AND t.semester=NEW.semester
   AND t.day_of_week=NEW.day_of_week
   AND (t.classroom_id=NEW.classroom_id OR t.teacher_user_id=NEW.teacher_user_id)
   AND t.period<=COALESCE(NEW.end_period,NEW.period)
   AND COALESCE(t.end_period,t.period)>=NEW.period
 );
END;
