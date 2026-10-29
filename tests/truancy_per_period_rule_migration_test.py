"""D1/SQLite regression: recorded period truancy uses the requested school criterion."""
import sqlite3
import unittest
from pathlib import Path

MIGRATIONS=Path(__file__).resolve().parents[1]/'worker'/'migrations'

class PerPeriodSchoolRuleTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for file in (
   '0001_initial.sql','0002_notification_outbox.sql',
   '0006_student_guardian_portal.sql','0007_teacher_timetable.sql',
   '0008_teacher_timetable_approvals.sql','0009_teacher_timetable_immediate.sql',
   '0013_truancy_push.sql','0018_student_affairs.sql',
   '0020_separate_merit_conduct_adjustments.sql','0023_behavior_record_soft_delete.sql',
   '0027_truancy_auto_score.sql'
  ):
   self.db.executescript((MIGRATIONS/file).read_text(encoding='utf8'))
  self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
   VALUES(1,'teacher','Teacher','teacher','s','h')""")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,2,1,'ม.2/1')")
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
   VALUES(1,'S1',1,1,'นักเรียนทดสอบ')""")
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(1,1,1,3,2,'Science')""")
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(2,1,1,3,3,'Math')""")
  for i in (1,2):
   self.db.execute("""INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
    VALUES(1,?,'2026-10-29','absent',1)""",(i,))
  self.db.commit()

 def tearDown(self):self.db.close()
 def migrate(self):
  self.db.executescript((MIGRATIONS/'0041_truancy_per_period_rule.sql').read_text(encoding='utf8'))
 def classify(self,lesson=1):
  self.db.execute("""INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
   VALUES(1,?,'2026-10-29',1)
   ON CONFLICT(student_id,timetable_id,school_date)
   DO UPDATE SET recorded_by=excluded.recorded_by,updated_at=CURRENT_TIMESTAMP""",(lesson,))
 def rules(self):
  return self.db.execute("""SELECT r.id,r.name,r.points,r.category,r.active
   FROM affairs_behavior_rules r JOIN truancy_score_policy p ON p.rule_id=r.id WHERE p.id=1""").fetchone()
 def history(self):
  return self.db.execute("""SELECT b.id,b.points,b.reason,b.affairs_category,ar.name,b.deleted_at
   FROM behavior_records b JOIN affairs_behavior_rules ar ON ar.id=b.affairs_rule_id
   ORDER BY b.id""").fetchall()

 def test_default_automatic_rule_renamed_and_scores_each_period(self):
  original=self.rules()[0]
  self.migrate()
  self.assertEqual(self.rules(),(original,'หนีเรียนในแต่ละคาบเรียน',-10,'moderate',1))
  self.classify(1)
  self.classify(2)
  found=self.history()
  self.assertEqual(len(found),2)
  self.assertEqual(sum(-x[1] for x in found),20)
  self.assertTrue(all(x[4]=='หนีเรียนในแต่ละคาบเรียน' for x in found))
  self.assertIn('หนีเรียนในแต่ละคาบเรียน วันที่ 2026-10-29 คาบ 2',found[0][2])
  self.assertIn('คาบ 3',found[1][2])
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

 def test_existing_school_rule_is_reused_without_doubling_the_criterion(self):
  old=self.rules()[0]
  self.db.execute("""INSERT INTO affairs_behavior_rules(name,category,points,active)
   VALUES('หนีเรียนในแต่ละคาบเรียน','serious',-30,1)""")
  imported=self.db.execute("""SELECT id FROM affairs_behavior_rules WHERE name='หนีเรียนในแต่ละคาบเรียน'""").fetchone()[0]
  self.db.commit()
  self.migrate()
  self.assertEqual(self.rules(),(imported,'หนีเรียนในแต่ละคาบเรียน',-30,'serious',1))
  self.assertEqual(self.db.execute("SELECT active FROM affairs_behavior_rules WHERE id=?",(old,)).fetchone()[0],0)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM affairs_behavior_rules WHERE name='หนีเรียนในแต่ละคาบเรียน'").fetchone()[0],1)
  self.classify()
  self.assertEqual(self.history()[0][1:5],(-30,'หนีเรียนในแต่ละคาบเรียน วันที่ 2026-10-29 คาบ 2','serious','หนีเรียนในแต่ละคาบเรียน'))
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

 def test_pre_migration_history_remains_and_correction_reverses_selected_record(self):
  self.classify()
  before=self.history()[0]
  self.migrate()
  after=self.history()[0]
  self.assertEqual(after[0],before[0])
  self.assertEqual(after[1],before[1])
  self.assertEqual(after[2],before[2])
  self.assertEqual(after[4],'หนีเรียนในแต่ละคาบเรียน')
  self.db.execute("""DELETE FROM period_truancy
   WHERE student_id=1 AND timetable_id=1 AND school_date='2026-10-29'""")
  self.assertIsNotNone(self.history()[0][5])
  self.classify()
  self.assertEqual(self.history()[0][0],before[0])
  self.assertIsNone(self.history()[0][5])
  self.assertEqual(len(self.history()),1)

 def test_repeated_migration_does_not_add_rules_or_points(self):
  self.migrate()
  self.classify()
  count=self.db.execute('SELECT count(*) FROM affairs_behavior_rules').fetchone()[0]
  before=self.history()[0]
  self.migrate()
  self.classify()
  self.assertEqual(count,self.db.execute('SELECT count(*) FROM affairs_behavior_rules').fetchone()[0])
  self.assertEqual(self.history()[0],before)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM behavior_records').fetchone()[0],1)

if __name__=='__main__':
 unittest.main()
