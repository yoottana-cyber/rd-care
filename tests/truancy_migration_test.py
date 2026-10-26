"""Truancy event accounting and correction, using the same SQLite schema as D1."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]/'worker'/'migrations'
def make_db():
 db=sqlite3.connect(':memory:')
 db.execute('PRAGMA foreign_keys=ON')
 for file in ['0001_initial.sql','0002_notification_outbox.sql','0006_student_guardian_portal.sql','0013_truancy_push.sql']:
  db.executescript((ROOT/file).read_text(encoding='utf8'))
 db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'t','Teacher','teacher','salt','hash')")
 db.execute("INSERT INTO classrooms(id,grade,room,label,advisor_user_id) VALUES(1,1,1,'ม.1/1',1)")
 db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(1,'ST1',1,1,'Student')")
 db.execute("INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject) VALUES(1,1,1,1,1,'Math')")
 db.execute("INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(1,1,'2026-10-26','absent',1)")
 return db

class TruancySchemaTest(unittest.TestCase):
 def test_event_deduplicates_and_correction_preserves_attendance(self):
  db=make_db()
  try:
   db.execute("INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by) VALUES(1,1,'2026-10-26',1)")
   db.execute("INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by) VALUES(1,1,'2026-10-26',1)")
   db.execute("""INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by)
      VALUES(1,1,'2026-10-26',1) ON CONFLICT(student_id,timetable_id,school_date)
      DO UPDATE SET active=1,recorded_by=excluded.recorded_by,
      generation=CASE WHEN truancy_events.active=0 THEN truancy_events.generation+1 ELSE truancy_events.generation END""")
   self.assertEqual(db.execute("SELECT active,generation FROM truancy_events").fetchone(),(1,1))
   db.execute("DELETE FROM period_truancy WHERE student_id=1")
   db.execute("UPDATE truancy_events SET active=0 WHERE student_id=1")
   self.assertEqual(db.execute("SELECT status FROM attendance_period").fetchone(),('absent',))
   db.execute("""INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by)
      VALUES(1,1,'2026-10-26',1) ON CONFLICT(student_id,timetable_id,school_date)
      DO UPDATE SET active=1,recorded_by=excluded.recorded_by,
      generation=CASE WHEN truancy_events.active=0 THEN truancy_events.generation+1 ELSE truancy_events.generation END""")
   self.assertEqual(db.execute("SELECT active,generation FROM truancy_events").fetchone(),(1,2))
  finally: db.close()

 def test_push_delivery_cannot_duplicate_one_event_device_generation(self):
  db=make_db()
  try:
   db.execute("INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by) VALUES(1,1,'2026-10-26',1)")
   q="INSERT OR IGNORE INTO truancy_push_deliveries(event_id,generation,recipient_type,subscription_id) VALUES(1,1,'advisor',1)"
   db.execute(q);db.execute(q)
   self.assertEqual(db.execute("SELECT COUNT(*) FROM truancy_push_deliveries").fetchone()[0],1)
  finally: db.close()

 def test_daily_attendance_cannot_be_saved_as_truancy(self):
  db=make_db()
  try:
   with self.assertRaises(sqlite3.IntegrityError):
    db.execute("INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(1,'2026-10-26','truancy',1)")
  finally: db.close()

if __name__=='__main__':unittest.main()
