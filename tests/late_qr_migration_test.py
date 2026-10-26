"""Verify QR late gate D1 schema and constraints with real SQLite."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/'worker'/'migrations'

def database():
 db=sqlite3.connect(':memory:')
 db.execute('PRAGMA foreign_keys=ON')
 for name in ('0001_initial.sql','0005_late_self_requests.sql','0015_late_qr_gate.sql'):
  db.executescript((MIGRATIONS/name).read_text(encoding='utf8'))
 db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
 VALUES(1,'duty','Duty Teacher','teacher','salt','hash')""")
 db.execute("""INSERT INTO classrooms(id,grade,room,label,advisor_user_id)
 VALUES(1,1,1,'ม.1/1',1)""")
 db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
 VALUES(1,'R0001',1,1,'Student One')""")
 db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
 VALUES(2,'R0002',1,2,'Student Two')""")
 db.execute("""INSERT INTO late_qr_tokens(id,issued_by,school_date,token_hash,expires_at)
 VALUES(1,1,'2026-10-26','hashed-token',9999999999)""")
 return db

class LateQrSchemaTests(unittest.TestCase):
 def setUp(self):self.db=database()
 def tearDown(self):self.db.close()
 def checkin(self,student,request_id):
  self.db.execute("""INSERT INTO late_self_requests(id,student_id,school_date,arrived_at,reason)
   VALUES(?,?, '2026-10-26','08:21','รถติด')""",(request_id,student))
  self.db.execute("""INSERT INTO late_qr_submissions(request_id,token_id,student_id,school_date,issued_by)
   VALUES(?,1,?,'2026-10-26',1)""",(request_id,student))
 def test_different_students_can_scan_same_gate_qr(self):
  self.checkin(1,1);self.checkin(2,2)
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM late_qr_submissions").fetchone()[0],2)
 def test_one_student_cannot_sign_in_twice_on_same_day(self):
  self.checkin(1,1)
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO late_qr_submissions(request_id,token_id,student_id,school_date,issued_by)
    VALUES(1,1,1,'2026-10-26',1)""")
 def test_student_cannot_get_automatic_approval_from_scan(self):
  self.checkin(1,1)
  self.assertEqual(self.db.execute("SELECT state FROM late_self_requests WHERE id=1").fetchone()[0],'pending')
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM late_records").fetchone()[0],0)
 def test_teacher_verification_inserts_existing_late_record(self):
  self.checkin(1,1)
  self.db.execute("""INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
    SELECT student_id,school_date,arrived_at,reason,'verified',1,1
    FROM late_self_requests WHERE id=1 AND state='pending'""")
  self.db.execute("UPDATE late_self_requests SET state='verified',verified_by=1 WHERE id=1")
  self.assertEqual(self.db.execute("SELECT status FROM attendance_daily").fetchall(),[])
  self.assertEqual(self.db.execute("SELECT state FROM late_self_requests").fetchone()[0],'verified')
  self.assertEqual(self.db.execute("SELECT state FROM late_records").fetchone()[0],'verified')
 def test_existing_late_record_uniqueness_prevents_duplicate(self):
  self.checkin(1,1)
  self.db.execute("""INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
    VALUES(1,'2026-10-26','08:30','','verified',1,1)""")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
    VALUES(1,'2026-10-26','08:31','','verified',1,1)""")
if __name__=='__main__':unittest.main()
