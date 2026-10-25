import pathlib, sqlite3, unittest, hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
class LateSelfTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ('0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql'):
   self.db.executescript((ROOT/'worker/migrations'/name).read_text(encoding='utf8'))
  self.db.executescript((ROOT/'worker/demo_seed.sql').read_text(encoding='utf8'))
  for name in ('0004_historical_enrollments.sql','0005_late_self_requests.sql'):
   self.db.executescript((ROOT/'worker/migrations'/name).read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES('staff','Staff','staff','salt','hash')")
  self.staff=self.db.execute("SELECT id FROM users WHERE username='staff'").fetchone()[0]
  self.student=self.db.execute("SELECT id FROM students ORDER BY id LIMIT 1").fetchone()[0]
  self.codehash=hashlib.sha256(b'feed1234feed1234feed1234').hexdigest()
  self.date='2026-10-25'
  self.db.execute('INSERT INTO late_self_passcodes(student_id,school_date,code_hash,expires_at,issued_by) VALUES(?,?,?,?,?)',
   (self.student,self.date,self.codehash,1900000000,self.staff))
  self.passcode_id=self.db.execute('SELECT id FROM late_self_passcodes LIMIT 1').fetchone()[0]
 def tearDown(self):self.db.close()
 def submit(self):
  created=self.db.execute('''INSERT INTO late_self_requests(student_id,school_date,arrived_at,reason)
   SELECT student_id,school_date,'08:35','รถติด' FROM late_self_passcodes
   WHERE id=? AND code_hash=? AND consumed_at IS NULL AND expires_at>1800000000
   AND NOT EXISTS(SELECT 1 FROM late_records l WHERE l.student_id=late_self_passcodes.student_id AND l.school_date=late_self_passcodes.school_date)''',
   (self.passcode_id,self.codehash)).rowcount
  consumed=self.db.execute('UPDATE late_self_passcodes SET consumed_at=1800000000 WHERE id=? AND consumed_at IS NULL',
   (self.passcode_id,)).rowcount
  return created,consumed
 def test_submission_creates_pending_request_and_never_late_record(self):
  self.assertEqual(self.submit(),(1,1))
  self.assertEqual(self.db.execute('SELECT state FROM late_self_requests').fetchone()[0],'pending')
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM late_records').fetchone()[0],0)
  self.assertEqual(self.db.execute('SELECT consumed_at FROM late_self_passcodes').fetchone()[0],1800000000)
 def test_same_day_duplicate_request_rejected(self):
  self.submit()
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO late_self_requests(student_id,school_date,arrived_at) VALUES(?,?,?)',
    (self.student,self.date,'09:00'))
 def test_staff_confirmation_creates_verified_late_record(self):
  self.submit()
  self.db.execute('''INSERT INTO late_records(student_id,school_date,arrived_at,reason,state,recorded_by,reviewed_by)
   SELECT student_id,school_date,arrived_at,reason,'verified',?,? FROM late_self_requests WHERE state='pending' ''',
   (self.staff,self.staff))
  self.db.execute("UPDATE late_self_requests SET state='verified',verified_by=? WHERE state='pending'",(self.staff,))
  self.assertEqual(self.db.execute('SELECT state FROM late_records').fetchone()[0],'verified')
  self.assertEqual(self.db.execute('SELECT state FROM late_self_requests').fetchone()[0],'verified')
 def test_rejected_request_does_not_create_late_record(self):
  self.submit()
  self.db.execute("UPDATE late_self_requests SET state='rejected',verified_by=? WHERE state='pending'",(self.staff,))
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM late_records').fetchone()[0],0)
 def test_expired_code_cannot_create_request(self):
  self.db.execute('UPDATE late_self_passcodes SET expires_at=1799999999')
  self.assertEqual(self.db.execute('''INSERT INTO late_self_requests(student_id,school_date,arrived_at)
   SELECT student_id,school_date,'08:36' FROM late_self_passcodes
   WHERE id=? AND consumed_at IS NULL AND expires_at>1800000000''',(self.passcode_id,)).rowcount,0)
if __name__=='__main__':unittest.main()
