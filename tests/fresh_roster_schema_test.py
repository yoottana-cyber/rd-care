"""Verify a newly initialized D1 keeps identity unique and permits old roll reuse."""
import sqlite3
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]/'worker'/'migrations'

class FreshRosterSchema(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for path in sorted(ROOT.glob('[0-9][0-9][0-9][0-9]_*.sql')):
   self.db.executescript(path.read_text(encoding='utf-8'))
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES (1,1,1,'ม.1/1')")

 def tearDown(self):
  self.db.close()

 def test_archived_identity_keeps_id_but_releases_old_roll(self):
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name,active,deleted_at)
   VALUES(1,'archived-student-1',1,1,'ข้อมูลเก่า',0,'2026-10-28')""")
  self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name,active) VALUES(2,'20046',1,1,'ข้อมูลใหม่',1)")
  self.assertEqual(self.db.execute("SELECT count(*) FROM students WHERE classroom_id=1 AND roll_no=1").fetchone()[0],2)
  self.assertEqual(self.db.execute("SELECT id,student_no FROM students WHERE id=1").fetchone(),(1,'archived-student-1'))
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('20047',1,1,'ชนเลขที่')")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('20046',1,3,'ชนรหัสนักเรียน')")
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

 def test_inactive_unarchived_student_still_reserves_roll(self):
  self.db.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name,active) VALUES('STU1',1,5,'พักข้อมูล',0)")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('STU2',1,5,'เลขที่ซ้ำ')")
  sql=self.db.execute("SELECT sql FROM sqlite_master WHERE name='students'").fetchone()[0]
  self.assertNotIn('UNIQUE(classroom_id,roll_no)',sql)
  self.assertEqual(self.db.execute("SELECT name FROM sqlite_master WHERE name='uq_students_current_room_roll'").fetchone()[0],
   'uq_students_current_room_roll')

 def test_blank_database_gets_only_rooms_and_never_demo_students(self):
  self.db.execute("DELETE FROM classrooms WHERE id=1")
  seed=(ROOT.parent/'classrooms_only.sql').read_text(encoding='utf-8')
  self.db.executescript(seed)
  self.assertEqual(self.db.execute('SELECT count(*) FROM classrooms').fetchone()[0],48)
  self.assertEqual(self.db.execute('SELECT count(*) FROM students').fetchone()[0],0)
  self.db.executescript(seed)
  self.assertEqual(self.db.execute('SELECT count(*) FROM classrooms').fetchone()[0],48)
  self.db.execute("DELETE FROM classrooms WHERE grade=6 AND room=7")
  self.db.executescript(seed)
  self.assertEqual(self.db.execute('SELECT count(*) FROM classrooms').fetchone()[0],47)

if __name__=='__main__':
 unittest.main()
