"""Indexes for large imports: keep case-insensitive student identity lookups fast."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]/'worker'/'migrations'
class LargeRosterLookupIndexTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for path in ('0001_initial.sql','0006_student_guardian_portal.sql'):
   self.db.executescript((ROOT/path).read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'admin','Admin','admin','s','h')")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'ม.1/1')")
  for i in range(1,1751):
   self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(?,?,1,?,?)",
    (i,'S'+str(i).zfill(6),(i-1)%100+1,'Student '+str(i))) if i <=100 else None
  self.db.execute("INSERT INTO portal_accounts(username,display_name,role,student_id,password_salt,password_hash,created_by) VALUES('student00001','Student','student',1,'salt','hash',1)")
  self.db.commit()
  self.db.executescript((ROOT/'0030_large_roster_import_lookup.sql').read_text(encoding='utf8'))
 def tearDown(self):self.db.close()
 def test_case_insensitive_indexes_preserve_students_and_accounts(self):
  self.assertEqual(self.db.execute("SELECT id FROM students WHERE lower(student_no)=?",('s000001',)).fetchone(),(1,))
  self.assertEqual(self.db.execute("SELECT student_id FROM portal_accounts WHERE lower(username)=?",('student00001',)).fetchone(),(1,))
  names={row[1] for row in self.db.execute("PRAGMA index_list('students')")}
  self.assertIn('idx_students_import_no_casefold',names)
  names={row[1] for row in self.db.execute("PRAGMA index_list('portal_accounts')")}
  self.assertIn('idx_portal_import_username_casefold',names)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_existing_identity_ids_are_not_rewritten(self):
  self.db.executescript((ROOT/'0030_large_roster_import_lookup.sql').read_text(encoding='utf8'))
  self.assertEqual(self.db.execute("SELECT id,student_no FROM students WHERE id=1").fetchone(),(1,'S000001'))
  self.assertEqual(self.db.execute("SELECT student_id FROM portal_accounts WHERE id=1").fetchone(),(1,))
 def test_casefold_where_uses_expression_index(self):
  for table,field,index in (
   ('students','student_no','idx_students_import_no_casefold'),
   ('portal_accounts','username','idx_portal_import_username_casefold')
  ):
   query=self.db.execute(
    f'EXPLAIN QUERY PLAN SELECT id FROM {table} WHERE lower({field})=?',
    ('s000001' if table=='students' else 'student00001',)
   ).fetchall()
   self.assertTrue(any(index in str(step) for step in query),(table,query))
if __name__=='__main__':unittest.main()
