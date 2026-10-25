import pathlib, sqlite3, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class TransferPlanTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for migration in ('0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql'):
   self.db.executescript((ROOT/'worker'/'migrations'/migration).read_text(encoding='utf8'))
  self.db.executescript((ROOT/'worker'/'demo_seed.sql').read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES('admin','Demo','admin','salt','hash')")
  self.student=self.db.execute("SELECT id FROM students LIMIT 1").fetchone()[0]
  self.source=self.db.execute("SELECT classroom_id FROM students WHERE id=?",(self.student,)).fetchone()[0]
  self.target=self.db.execute("SELECT id FROM classrooms WHERE id<>? LIMIT 1",(self.source,)).fetchone()[0]
 def tearDown(self):self.db.close()
 def test_planned_transfer_does_not_update_current_student_classroom(self):
  self.db.execute('INSERT INTO student_transfer_plans(student_id,from_classroom_id,to_classroom_id,school_year,term,created_by) VALUES(?,?,?,?,?,?)',
  (self.student,self.source,self.target,2569,2,1))
  self.assertEqual(self.db.execute('SELECT classroom_id FROM students WHERE id=?',(self.student,)).fetchone()[0],self.source)
  self.assertEqual(self.db.execute('SELECT state FROM student_transfer_plans WHERE student_id=?',(self.student,)).fetchone()[0],'planned')
 def test_rejects_duplicate_year_term_and_same_room(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO student_transfer_plans(student_id,from_classroom_id,to_classroom_id,school_year,term,created_by) VALUES(?,?,?,?,?,?)',
   (self.student,self.source,self.source,2569,2,1))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO student_transfer_plans(student_id,from_classroom_id,to_classroom_id,school_year,term,created_by) VALUES(?,?,?,?,?,?)',
   (self.student,self.source,self.target,2569,3,1))
if __name__=='__main__':unittest.main()
