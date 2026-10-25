import pathlib, sqlite3, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]

class PortalPrivacyTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for migration in ('0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql'):
   self.db.executescript((ROOT/'worker/migrations'/migration).read_text(encoding='utf8'))
  self.db.executescript((ROOT/'worker/demo_seed.sql').read_text(encoding='utf8'))
  for migration in ('0004_historical_enrollments.sql','0005_late_self_requests.sql','0006_student_guardian_portal.sql'):
   self.db.executescript((ROOT/'worker/migrations'/migration).read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES('admin','Admin','admin','salt','hash')")
  self.sid1,self.sid2=[r[0] for r in self.db.execute('SELECT id FROM students ORDER BY id LIMIT 2')]
  self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,created_by)
      VALUES('student-01','Demo Student','student',?,'s','h',1)""",(self.sid1,))
  self.student_account=self.db.execute("SELECT id FROM portal_accounts WHERE role='student'").fetchone()[0]
  self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,password_salt,password_hash,created_by)
      VALUES('guardian-01','Demo Guardian','guardian','s','h',1)""")
  self.guardian=self.db.execute("SELECT id FROM portal_accounts WHERE role='guardian'").fetchone()[0]
 def tearDown(self):self.db.close()
 def linked(self,student):
  return self.db.execute("""SELECT s.id FROM students s
    WHERE s.id=? AND s.active=1 AND EXISTS(
      SELECT 1 FROM guardian_student_links link WHERE link.guardian_account_id=? AND link.student_id=s.id
    )""",(student,self.guardian)).fetchone()
 def test_guardian_denied_until_staff_verified_link(self):
  self.assertIsNone(self.linked(self.sid1))
  self.db.execute("INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,1)",
                 (self.guardian,self.sid1))
  self.assertEqual(self.linked(self.sid1),(self.sid1,))
  self.assertIsNone(self.linked(self.sid2))
  self.db.execute("DELETE FROM guardian_student_links WHERE guardian_account_id=? AND student_id=?",
                 (self.guardian,self.sid1))
  self.assertIsNone(self.linked(self.sid1))
 def test_student_account_cannot_receive_guardian_links(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,1)",
                   (self.student_account,self.sid2))
 def test_only_one_student_account_and_case_insensitive_username(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,created_by)
     VALUES('student-02','Other','student',?,'s','h',1)""",(self.sid1,))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,password_salt,password_hash,created_by)
     VALUES('GUARDIAN-01','Other','guardian','s','h',1)""")
 def test_parent_cannot_be_created_with_student_id(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,created_by)
     VALUES('guardian-03','Other','guardian',?,'s','h',1)""",(self.sid2,))
 def test_history_scoped_records_ignore_unlinked_student(self):
  self.db.execute("INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,'late',1)",(self.sid1,'2026-10-25'))
  self.db.execute("INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,'absent',1)",(self.sid2,'2026-10-25'))
  self.db.execute("INSERT INTO guardian_student_links(guardian_account_id,student_id,verified_by) VALUES(?,?,1)",
                 (self.guardian,self.sid1))
  linked=[r[0] for r in self.db.execute("""SELECT a.student_id FROM attendance_daily a JOIN guardian_student_links l
   ON l.student_id=a.student_id WHERE l.guardian_account_id=? AND a.school_date BETWEEN ? AND ?""",
   (self.guardian,'2026-10-01','2026-10-31'))]
  self.assertEqual(linked,[self.sid1])
if __name__=='__main__':unittest.main()
