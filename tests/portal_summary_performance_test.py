"""Regression for D1 portal summary counts and planner work at school scale.

Reads the actual query from worker/src/portal.js, applies real D1 migrations,
and compares correctness and SQLite VM work against the old correlated query.
No Cloudflare credentials, private student data, or remote writes are used.
"""
from pathlib import Path
import sqlite3
import unittest

ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/'worker'/'migrations'
SOURCE=(ROOT/'worker'/'src'/'portal.js').read_text(encoding='utf8')
START='env.DB.prepare(`SELECT COUNT(*) AS n FROM students s'
assert START in SOURCE, 'Portal summary SQL not found'
OFFSET=SOURCE.index(START)+len('env.DB.prepare(`')
OPTIMIZED=SOURCE[OFFSET:SOURCE.index('`)',OFFSET)]
ORIGINAL="""SELECT COUNT(*) AS n FROM students s WHERE s.active=1 AND NOT EXISTS (
 SELECT 1 FROM guardian_student_links l JOIN portal_accounts a
 ON a.id=l.guardian_account_id AND a.role='guardian' AND a.active=1
 WHERE l.student_id=s.id)"""

class GuardianSummaryPerformanceTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for file in ('0001_initial.sql','0006_student_guardian_portal.sql'):
   self.db.executescript((MIGRATIONS/file).read_text(encoding='utf8'))
  self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
    VALUES(1,'administrator','Administrator','admin','salt','hash')""")
  self.db.executemany('INSERT INTO classrooms(id,grade,room,label) VALUES(?,1,?,?)',
   [(i,i,'ม.1/'+str(i)) for i in range(1,19)])
  self.db.executemany("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
    VALUES(?,?,?,?,?)""",[
    (i,'S'+str(i).zfill(6),(i-1)//100+1,(i-1)%100+1,'Student '+str(i))
    for i in range(1,1801)])
  self.db.executemany("""INSERT INTO portal_accounts(id,username,display_name,role,
    password_salt,password_hash,created_by)
    VALUES(? ,?,'Guardian','guardian','salt','hash',1)""",[
    (i,'guardian'+str(i)) for i in range(1,1801)])
  self.db.commit()

 def tearDown(self):
  self.db.close()

 def count(self,query=OPTIMIZED):
  return self.db.execute(query).fetchone()[0]

 def link(self,guardian,student):
  self.db.execute("""INSERT INTO guardian_student_links
    (guardian_account_id,student_id,verified_by) VALUES(?,?,1)""",(guardian,student))

 def test_optimized_matches_old_query_across_guardian_statuses(self):
  self.assertEqual(self.count(),1800)
  self.db.executemany("""INSERT INTO guardian_student_links
    (guardian_account_id,student_id,verified_by) VALUES(?,?,1)""",
    [(i,i) for i in range(1,1001)])
  self.assertEqual(self.count(),800)
  self.assertEqual(self.count(),self.count(ORIGINAL))
  self.link(1001,1) # two verified guardians do not double count
  self.assertEqual(self.count(),800)
  self.db.execute('UPDATE portal_accounts SET active=0 WHERE id=999')
  self.assertEqual(self.count(),801) # an inactive guardian is no longer linked
  self.db.execute('UPDATE students SET active=0 WHERE id=1500')
  self.assertEqual(self.count(),800) # only active students enter the denominator
  self.link(1002,1500) # linked but paused student is excluded
  self.assertEqual(self.count(),800)
  self.assertEqual(self.count(),self.count(ORIGINAL))
  self.db.execute('UPDATE portal_accounts SET active=1 WHERE id=999')
  self.assertEqual(self.count(),799)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

 def test_school_scale_query_materializes_links_instead_of_correlating_scans(self):
  self.db.executemany("""INSERT INTO guardian_student_links
    (guardian_account_id,student_id,verified_by) VALUES(?,?,1)""",
    [(i,i) for i in range(1,1801)])
  self.db.commit()
  plan=[row[3] for row in self.db.execute('EXPLAIN QUERY PLAN '+OPTIMIZED)]
  self.assertFalse(any('CORRELATED' in p for p in plan),plan)
  self.assertTrue(any('LIST SUBQUERY' in p for p in plan),plan)
  def steps(query):
   count=[0]
   def progress():
    count[0]+=1000
    return 0
   self.db.set_progress_handler(progress,1000)
   try:
    answer=self.count(query)
   finally:
    self.db.set_progress_handler(None,0)
   return answer,count[0]
  original,old_steps=steps(ORIGINAL)
  current,new_steps=steps(OPTIMIZED)
  self.assertEqual(original,current)
  self.assertGreater(old_steps,new_steps*10,(old_steps,new_steps))
  print('Guardian summary SQLite VM steps: old=',old_steps,'new=',new_steps)

if __name__=='__main__': unittest.main()
