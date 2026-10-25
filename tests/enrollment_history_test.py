import pathlib, sqlite3, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
class EnrollmentHistoryTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for name in ['0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql','0004_historical_enrollments.sql']:
   if name=='0004_historical_enrollments.sql':
    self.db.executescript((ROOT/'worker'/'demo_seed.sql').read_text(encoding='utf-8'))
   self.db.executescript((ROOT/'worker'/'migrations'/name).read_text(encoding='utf-8'))
  self.db.execute("INSERT INTO users(username,display_name,role,password_salt,password_hash) VALUES('demo','Demo','admin','s','h')")
  self.student,self.source,self.old_roll=self.db.execute('SELECT id,classroom_id,roll_no FROM students LIMIT 1').fetchone()
  self.target=self.db.execute('SELECT id FROM classrooms WHERE id<>? ORDER BY id LIMIT 1',(self.source,)).fetchone()[0]
  self.db.execute('INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) VALUES(?,?,?,?)',
                  (self.student,'2026-10-24','present',1))
  self.db.execute('INSERT INTO student_transfer_plans(student_id,from_classroom_id,to_classroom_id,school_year,term,created_by) VALUES(?,?,?,?,?,?)',
                  (self.student,self.source,self.target,2569,1,1))
 def tearDown(self):self.db.close()
 def move(self,roll=6):
  self.db.execute('UPDATE student_enrollments SET end_date=? WHERE student_id=? AND end_date IS NULL',('2026-10-25',self.student))
  self.db.execute('INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by) VALUES(?,?,?,?,?)',
     (self.student,self.target,roll,'2026-10-25',1))
  self.db.execute('UPDATE students SET classroom_id=?,roll_no=? WHERE id=?',(self.target,roll,self.student))
  self.db.execute('INSERT INTO student_transfer_applications(plan_id,student_id,from_classroom_id,to_classroom_id,old_roll_no,new_roll_no,effective_date,executed_by) VALUES(1,?,?,?,?,?,?,?)',
    (self.student,self.source,self.target,self.old_roll,roll,'2026-10-25',1))
 def records(self,room,date):
  return self.db.execute('''SELECT d.student_id FROM attendance_daily d
    JOIN student_enrollments h ON h.student_id=d.student_id
    WHERE h.classroom_id=? AND d.school_date=?
    AND h.start_date<=d.school_date AND (h.end_date IS NULL OR h.end_date>d.school_date)''',
    (room,date)).fetchall()
 def test_migration_backfills_all_demo_students(self):
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM students').fetchone()[0],
    self.db.execute('SELECT COUNT(*) FROM student_enrollments').fetchone()[0])
 def test_move_preserves_old_room_history_and_new_roster(self):
  self.move()
  self.assertEqual(self.db.execute('SELECT classroom_id FROM students WHERE id=?',(self.student,)).fetchone()[0],self.target)
  self.assertEqual(self.records(self.source,'2026-10-24'),[(self.student,)])
  self.assertEqual(self.records(self.target,'2026-10-24'),[])
  self.assertEqual(self.db.execute('''SELECT classroom_id FROM student_enrollments WHERE student_id=? AND
    start_date<=? AND (end_date IS NULL OR end_date>?)''',(self.student,'2026-10-24','2026-10-24')).fetchone()[0],self.source)
  self.assertEqual(self.db.execute('''SELECT classroom_id FROM student_enrollments WHERE student_id=? AND
    start_date<=? AND (end_date IS NULL OR end_date>?)''',(self.student,'2026-10-25','2026-10-25')).fetchone()[0],self.target)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM student_transfer_applications').fetchone()[0],1)
 def test_current_room_roll_conflicts_rejected(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,?,?)',
    (self.student,self.source,self.old_roll,'2026-10-25'))
  other=self.db.execute('SELECT id FROM students WHERE classroom_id=? ORDER BY id LIMIT 1',(self.target,)).fetchone()
  if other:
   other_roll=self.db.execute('SELECT roll_no FROM students WHERE id=?',other).fetchone()[0]
   with self.assertRaises(sqlite3.IntegrityError):
    self.db.execute('INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(?,?,?,?)',
       (self.student,self.target,other_roll,'2026-10-25'))
 def test_prevents_invalid_date_intervals(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute('UPDATE student_enrollments SET end_date=? WHERE student_id=?',('1800-01-01',self.student))

if __name__=='__main__':unittest.main()
