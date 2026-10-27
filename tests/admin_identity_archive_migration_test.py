import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]

class ArchivePreservesSchoolReferences(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for file in ['worker/migrations/0001_initial.sql',
               'worker/migrations/0006_student_guardian_portal.sql',
               'worker/migrations/0022_admin_account_archive.sql']:
   self.db.executescript((ROOT/file).read_text(encoding='utf-8'))
  self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
   VALUES(1,'admin','Administrator','admin','s','h')""")
  self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
   VALUES(2,'teacher','Teacher Name','teacher','s','h')""")
  self.db.execute("""INSERT INTO classrooms(id,grade,room,label,advisor_user_id)
   VALUES(1,1,1,'ม.1/1',2)""")
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
   VALUES(3,'001234',1,1,'ชื่อเดิม')""")
 def tearDown(self): self.db.close()
 def test_teacher_anonymization_retains_historical_signatures(self):
  self.db.execute("""INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
   VALUES(3,'2026-10-20','present',2)""")
  self.db.execute("""UPDATE users SET active=0,deleted_at=CURRENT_TIMESTAMP,
   username='archived-staff-2',display_name='บุคลากรที่ออกจากระบบ #2'
   WHERE id=2""")
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM attendance_daily').fetchone()[0],1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM users WHERE deleted_at IS NULL').fetchone()[0],1)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_student_removal_preserves_attendance_and_deactivates_record(self):
  self.db.execute("""INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
   VALUES(3,'2026-10-20','present',2)""")
  self.db.execute("""INSERT INTO portal_accounts(id,username,display_name,role,student_id,
   password_salt,password_hash,created_by) VALUES(7,'student07','Student','student',3,'s','h',1)""")
  self.db.execute('DELETE FROM portal_accounts WHERE student_id=3')
  self.db.execute("""UPDATE students SET active=0,deleted_at=CURRENT_TIMESTAMP,
   student_no='archived-student-3',full_name='ข้อมูลนักเรียนที่ถอนออก #3' WHERE id=3""")
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM portal_accounts').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM attendance_daily').fetchone()[0],1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM students WHERE deleted_at IS NULL').fetchone()[0],0)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_guardian_full_account_delete_does_not_delete_linked_student(self):
  self.db.execute("""INSERT INTO portal_accounts(id,username,display_name,role,
   password_salt,password_hash,created_by)
   VALUES(9,'guardian09','Parent','guardian','s','h',1)""")
  self.db.execute('INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(9,3,1)')
  self.db.execute('DELETE FROM portal_accounts WHERE id=9')
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM guardian_student_links').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM students').fetchone()[0],1)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

if __name__=='__main__': unittest.main()
