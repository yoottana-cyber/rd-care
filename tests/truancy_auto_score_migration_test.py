"""Real SQLite/D1 regression for automatic -10 truancy penalties.

A penalty belongs to one student/lesson/date, and follows the classification:
create once, never double-charge, reverse on correction, restore on reclassification.
"""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/'worker'/'migrations'

class AutoTruancyScoreTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for file in ('0001_initial.sql','0002_notification_outbox.sql',
               '0006_student_guardian_portal.sql','0013_truancy_push.sql',
               '0018_student_affairs.sql','0020_separate_merit_conduct_adjustments.sql',
               '0023_behavior_record_soft_delete.sql'):
   self.db.executescript((MIGRATIONS/file).read_text(encoding='utf8'))
  self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
   VALUES(1,'teacher','Teacher','teacher','s','h')""")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label,advisor_user_id) VALUES(1,2,1,'M2/1',1)")
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
   VALUES(1,'S1',1,1,'Student A')""")
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(1,1,1,3,2,'Science')""")
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(2,1,1,3,3,'Math')""")
  self.db.execute("""INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
   VALUES(1,1,'2026-10-28','absent',1)""")
  self.db.execute("""INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
   VALUES(1,2,'2026-10-28','absent',1)""")
  self.db.execute("""INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
   VALUES(1,'2026-10-28','absent',1)""")
  self.db.commit()
  self.migration=(MIGRATIONS/'0027_truancy_auto_score.sql').read_text(encoding='utf8')
  self.db.executescript(self.migration)

 def tearDown(self):self.db.close()
 def classify(self,lesson=1):
  self.db.execute("""INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
   VALUES(1,?,'2026-10-28',1) ON CONFLICT(student_id,timetable_id,school_date)
   DO UPDATE SET recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP""",(lesson,))
 def score(self):
  return self.db.execute("""SELECT b.id,b.student_id,b.points,b.reason,b.deleted_at,
    b.affairs_category,r.name AS action
   FROM behavior_records b LEFT JOIN affairs_behavior_rules r ON r.id=b.affairs_rule_id
   ORDER BY b.id""").fetchall()
 def total(self):
  return self.db.execute("""SELECT COALESCE(SUM(-points),0) FROM behavior_records
   WHERE points<0 AND deleted_at IS NULL""").fetchone()[0]

 def test_classification_deducts_ten_under_named_school_rule(self):
  self.assertEqual(self.total(),0)
  self.classify()
  self.assertEqual(self.total(),10)
  entry=self.score()[0]
  self.assertEqual(entry[1:3],(1,-10))
  self.assertIn('หนีเรียน',entry[3])
  self.assertIn('2026-10-28',entry[3])
  self.assertIn('คาบ 2',entry[3])
  self.assertEqual(entry[4],None)
  self.assertEqual(entry[5:7],('moderate','หนีเรียน'))
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

 def test_repeat_save_is_idempotent_even_when_updating_existing_truancy(self):
  self.classify()
  original=self.score()[0][0]
  self.classify()
  self.classify()
  self.assertEqual(self.total(),10)
  self.assertEqual(len(self.score()),1)
  self.assertEqual(self.score()[0][0],original)
  self.assertEqual(self.db.execute("""SELECT COUNT(*) FROM audit_logs
   WHERE action='truancy_auto_score_applied'""").fetchone()[0],1)

 def test_correction_refunds_and_reclassification_restores_same_record(self):
  self.classify()
  rowid=self.score()[0][0]
  self.db.execute("""UPDATE attendance_period SET status='present'
   WHERE student_id=1 AND timetable_id=1 AND school_date='2026-10-28'""")
  self.db.execute("""DELETE FROM period_truancy
   WHERE student_id=1 AND timetable_id=1 AND school_date='2026-10-28'""")
  self.assertEqual(self.total(),0)
  self.assertIsNotNone(self.score()[0][4])
  self.assertEqual(self.db.execute("""SELECT COUNT(*) FROM audit_logs
   WHERE action='truancy_auto_score_reversed'""").fetchone()[0],1)
  self.db.execute("""UPDATE attendance_period SET status='absent'
   WHERE student_id=1 AND timetable_id=1 AND school_date='2026-10-28'""")
  self.classify()
  self.assertEqual(self.total(),10)
  self.assertEqual(len(self.score()),1)
  self.assertEqual(self.score()[0][0],rowid)
  self.assertIsNone(self.score()[0][4])
  self.assertEqual(self.db.execute("""SELECT COUNT(*) FROM audit_logs
   WHERE action='truancy_auto_score_applied'""").fetchone()[0],2)

 def test_two_distinct_truancy_periods_are_distinct_events(self):
  self.classify(1)
  self.classify(2)
  self.assertEqual(self.total(),20)
  self.assertEqual(len(self.score()),2)
  self.db.execute("""DELETE FROM period_truancy WHERE student_id=1
   AND timetable_id=1 AND school_date='2026-10-28'""")
  self.assertEqual(self.total(),10)

 def test_other_absences_and_daily_attendance_never_trigger_penalty(self):
  self.assertEqual(self.total(),0)
  self.db.execute("""UPDATE attendance_daily SET status='present' WHERE student_id=1""")
  self.db.execute("""UPDATE attendance_period SET status='late' WHERE timetable_id=1""")
  self.assertEqual(self.total(),0)

 def test_deleting_parent_period_truancy_via_cascade_reverses_penalty(self):
  self.classify()
  self.db.execute("DELETE FROM attendance_period WHERE student_id=1 AND timetable_id=1")
  self.assertEqual(self.total(),0)
  self.assertIsNotNone(self.score()[0][4])
  self.assertEqual(self.db.execute("PRAGMA foreign_key_check").fetchall(),[])

 def test_migration_does_not_retroactively_penalize_old_truancy(self):
  self.db.execute("DROP TRIGGER truancy_auto_score_on_insert")
  self.db.execute("""INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
   VALUES(1,1,'2026-10-28',1)""")
  self.db.executescript(self.migration)
  self.assertEqual(self.total(),0)
  self.classify()
  self.assertEqual(self.total(),0)  # legacy classified event stays unchanged

 def test_repeated_migration_does_not_create_second_managed_rule(self):
  original=self.db.execute("SELECT COUNT(*) FROM affairs_behavior_rules WHERE name='หนีเรียน'").fetchone()[0]
  self.db.executescript(self.migration)
  updated=self.db.execute("SELECT COUNT(*) FROM affairs_behavior_rules WHERE name='หนีเรียน'").fetchone()[0]
  self.assertEqual(original,1)
  self.assertEqual(updated,original)

if __name__=='__main__':unittest.main()
