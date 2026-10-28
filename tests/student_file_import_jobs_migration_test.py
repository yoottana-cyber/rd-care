"""Durable Excel/CSV file import migration: 1750 rows, FK and resume invariants."""
import pathlib
import sqlite3
import unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]/"worker"/"migrations"
class StudentFileJobMigrationTests(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.executescript((ROOT/'0001_initial.sql').read_text(encoding='utf8'))
  self.db.executescript((ROOT/'0031_student_file_import_jobs.sql').read_text(encoding='utf8'))
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'admin','Admin','admin','s','h')")
  self.db.execute("INSERT INTO student_file_import_jobs(id,actor_id,total) VALUES('job-1',1,1750)")
 def tearDown(self):self.db.close()
 def test_staging_all_1750_rows_and_safe_idempotent_reupload(self):
  self.db.executemany("""INSERT OR IGNORE INTO student_file_import_rows
    (job_id,source_row,student_no,classroom,roll_no,full_name)
    VALUES ('job-1',?,?,?,?,?)""",
    [(i+2,'S'+str(i).zfill(6),'ม.1/'+str(i//100+1),i%100+1,'นักเรียน'+str(i))
      for i in range(1750)])
  self.db.execute("INSERT OR IGNORE INTO student_file_import_rows(job_id,source_row,student_no,classroom,roll_no,full_name) VALUES('job-1',2,'S000000','ม.1/1',1,'repeat')")
  self.db.execute("UPDATE student_file_import_jobs SET uploaded=(SELECT COUNT(*) FROM student_file_import_rows WHERE job_id='job-1') WHERE id='job-1'")
  self.assertEqual(self.db.execute("SELECT uploaded FROM student_file_import_jobs").fetchone(),(1750,))
  self.db.execute("UPDATE student_file_import_jobs SET status='ready' WHERE id='job-1' AND uploaded=total")
  self.assertEqual(self.db.execute("SELECT status FROM student_file_import_jobs").fetchone(),('ready',))
  self.assertEqual(self.db.execute("SELECT full_name FROM student_file_import_rows WHERE job_id='job-1' AND source_row=2").fetchone(),('นักเรียน0',))
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM student_file_import_rows WHERE job_id='job-1'").fetchone(),(1750,))
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_job_progress_idempotency_and_atomic_updates(self):
  self.db.execute("INSERT INTO student_file_import_rows(job_id,source_row,student_no,classroom,roll_no,full_name) VALUES('job-1',2,'S000002','ม.1/1',2,'นักเรียน')")
  self.db.execute("UPDATE student_file_import_rows SET state='updated' WHERE job_id='job-1' AND source_row=2 AND state='pending'")
  self.db.execute("UPDATE student_file_import_jobs SET processed=1,updated=1 WHERE id='job-1'")
  self.assertEqual(self.db.execute("UPDATE student_file_import_rows SET state='updated' WHERE job_id='job-1' AND source_row=2 AND state='pending'").rowcount,0)
  self.assertEqual(self.db.execute("SELECT processed,updated FROM student_file_import_jobs").fetchone(),(1,1))
 def test_foreign_key_cleanup_on_expired_jobs(self):
  self.db.execute("INSERT INTO student_file_import_rows(job_id,source_row,student_no,classroom,roll_no,full_name) VALUES('job-1',2,'S000002','ม.1/1',2,'นักเรียน')")
  self.db.execute("DELETE FROM student_file_import_jobs WHERE id='job-1'")
  self.assertEqual(self.db.execute("SELECT COUNT(*) FROM student_file_import_rows").fetchone()[0],0)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_reject_invalid_total_status_and_row_status(self):
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("INSERT INTO student_file_import_jobs(id,actor_id,total) VALUES('bad',1,10001)")
  with self.assertRaises(sqlite3.IntegrityError):
   self.db.execute("UPDATE student_file_import_jobs SET status='forgotten' WHERE id='job-1'")
if __name__=='__main__':unittest.main()
