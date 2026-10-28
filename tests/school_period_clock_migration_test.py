"""D1-compatible migration regression: class duration modes preserve school/attendance data."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]/'worker'/'migrations'
class PeriodClockMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ('0001_initial.sql','0024_school_settings.sql'):
   self.db.executescript((ROOT/name).read_text(encoding='utf8'))
  self.db.execute("UPDATE school_settings SET academic_year=2570,semester=1,school_start_time='07:40',late_cutoff_time='08:10'")
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'teacher','ครู','teacher','x','x')")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'1/1')")
  self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(1,'0001',1,1,'เด็กทดสอบ')")
  self.db.execute("INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject) VALUES(1,1,1,3,1,'คณิต')")
  self.db.execute("INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(1,1,'2026-10-28','present',1)")
  self.db.executescript((ROOT/'0028_school_period_clock.sql').read_text(encoding='utf8'))
 def tearDown(self):self.db.close()
 def test_defaults_do_not_change_late_qr_or_historical_attendance(self):
  self.assertEqual(self.db.execute("SELECT first_period_start_time,period_duration_minutes FROM school_settings").fetchone(),('08:30',50))
  self.assertEqual(self.db.execute("SELECT academic_year,semester,school_start_time,late_cutoff_time FROM school_settings").fetchone(),(2570,1,'07:40','08:10'))
  self.assertEqual(self.db.execute("SELECT timetable_id,status FROM attendance_period").fetchone(),(1,'present'))
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_only_supported_duration_modes(self):
  for duration in (50,45,40):
   self.db.execute("UPDATE school_settings SET period_duration_minutes=?",(duration,))
   self.assertEqual(self.db.execute("SELECT period_duration_minutes FROM school_settings").fetchone()[0],duration)
  for invalid in (0,39,41,44,46,55,60,-5):
   with self.assertRaises(sqlite3.IntegrityError):
    self.db.execute("UPDATE school_settings SET period_duration_minutes=?",(invalid,))
 def test_clock_change_keeps_timetable_and_checkin(self):
  self.db.execute("UPDATE school_settings SET first_period_start_time='09:00',period_duration_minutes=40")
  self.assertEqual(self.db.execute("SELECT id,period FROM timetable").fetchone(),(1,1))
  self.assertEqual(self.db.execute("SELECT school_date,status FROM attendance_period").fetchone(),('2026-10-28','present'))
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
if __name__=='__main__': unittest.main()
