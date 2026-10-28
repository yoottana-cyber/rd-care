"""Non-destructive timetable collision guards: existing attendance references survive."""
import pathlib
import sqlite3
import unittest
DIR=pathlib.Path(__file__).resolve().parents[1]/'worker'/'migrations'
class ClashGuardTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ['0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql',
   '0004_historical_enrollments.sql','0007_teacher_timetable.sql',
   '0008_teacher_timetable_approvals.sql','0009_teacher_timetable_immediate.sql']:
   self.db.executescript((DIR/name).read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'t1','T1','teacher','x','y')")
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(2,'t2','T2','teacher','x','y')")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'1/1')")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(2,1,2,'1/2')")
  self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(1,'S1',1,1,'Student')")
  self.db.execute("INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,end_period,subject) VALUES(10,1,1,1,1,2,'Old')")
  self.db.execute("INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(1,10,'2026-10-26','present',1)")
  self.db.executescript((DIR/'0026_timetable_clash_guards.sql').read_text(encoding='utf8'))
 def tearDown(self):self.db.close()
 def insert(self,room=1,teacher=1,period=2,end=2,day=1):
  return self.db.execute("""INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject)
   VALUES(?,?,?,?,?,'SCI','New')""",(room,teacher,day,period,end))
 def test_keeps_historical_attendance(self):
  self.assertEqual(self.db.execute("SELECT timetable_id,status FROM attendance_period").fetchall(),[(10,'present')])
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM timetable').fetchone()[0],1)
 def test_teacher_collision_across_classroom_and_pair(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
   self.insert(room=2,teacher=1,period=2)
  self.insert(room=2,teacher=1,period=3)
 def test_room_collision_with_another_teacher(self):
  with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
   self.insert(room=1,teacher=2,period=2,end=3)
  self.insert(room=1,teacher=2,period=3,end=4)
 def test_conflicting_update_rejected(self):
  self.insert(room=2,teacher=2,period=3)
  with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
   self.db.execute('UPDATE timetable SET period=2 WHERE classroom_id=2')
 def test_old_history_not_deleted_by_triggers(self):
  self.db.execute('UPDATE timetable SET active=0,approval_status=\'archived\' WHERE id=10')
  self.insert(room=1,teacher=2,period=2)
  self.assertEqual(self.db.execute('SELECT status FROM attendance_period WHERE timetable_id=10').fetchone()[0],'present')
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
if __name__=='__main__':unittest.main()
