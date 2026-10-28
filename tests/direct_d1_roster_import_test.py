"""Direct D1 import safety tests; run entirely offline, never access production."""
import csv
import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("direct_d1_roster",ROOT/"scripts"/"direct_d1_roster_import.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class DirectD1ImportTests(unittest.TestCase):
 def setUp(self):
  self.conn=sqlite3.connect(":memory:")
  self.conn.execute("PRAGMA foreign_keys=ON")
  self.conn.executescript("""
   CREATE TABLE classrooms(id INTEGER PRIMARY KEY,label TEXT UNIQUE);
   CREATE TABLE students(
     id INTEGER PRIMARY KEY AUTOINCREMENT,student_no TEXT NOT NULL UNIQUE,
     classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
     roll_no INTEGER NOT NULL CHECK(roll_no BETWEEN 1 AND 100),
     full_name TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,deleted_at TEXT,
     UNIQUE(classroom_id,roll_no)
   );
   CREATE TABLE student_enrollments(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
    roll_no INTEGER NOT NULL, start_date TEXT NOT NULL, changed_by INTEGER,
    end_date TEXT,UNIQUE(student_id,start_date)
   );
   CREATE UNIQUE INDEX uq_current_student ON student_enrollments(student_id) WHERE end_date IS NULL;
   CREATE UNIQUE INDEX uq_room_roll ON student_enrollments(classroom_id,roll_no) WHERE end_date IS NULL;
   CREATE TABLE portal_accounts(id INTEGER PRIMARY KEY,student_id INTEGER,password_hash TEXT);
   CREATE TABLE attendance_daily(student_id INTEGER,school_date TEXT,status TEXT);
   INSERT INTO classrooms VALUES(1,'ม.1/1');
   INSERT INTO classrooms VALUES(2,'ม.1/2');
   INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(1,'S0001',1,1,'ชื่อเดิม');
   INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) VALUES(1,1,1,'2026-05-01');
   INSERT INTO portal_accounts VALUES(1,1,'keep-hash');
   INSERT INTO attendance_daily VALUES(1,'2026-10-28','present');
  """)
 def tearDown(self): self.conn.close()
 def snapshot(self):
  rooms=[dict(zip(["id","label"],x)) for x in self.conn.execute("SELECT id,label FROM classrooms")]
  students=[dict(zip(["id","student_no","classroom_id","roll_no","full_name","active","deleted_at"],x))
   for x in self.conn.execute("SELECT id,student_no,classroom_id,roll_no,full_name,active,deleted_at FROM students")]
  enroll=[dict(zip(["student_id","classroom_id","roll_no"],x))
   for x in self.conn.execute("SELECT student_id,classroom_id,roll_no FROM student_enrollments WHERE end_date IS NULL")]
  return (rooms,students,enroll)
 @staticmethod
 def row(no,room="ม.1/1",roll="2",name="ชื่อใหม่"):
  return {"source_row":3,"student_no":no,"classroom":room,"roll_no":roll,"full_name":name}
 def apply(self,planned):
  for row in planned:
   for sql in mod.row_sql(row,42,"2026-10-28"):
    self.conn.execute(sql)
  self.conn.commit()
 def test_updates_existing_id_and_enrollment_without_touching_attendance_or_password(self):
  plan=mod.plan_rows([self.row("S0001",roll="3",name="จันทร์ O'Neil")],self.snapshot())
  self.assertEqual(plan[0]["action"],"update")
  self.apply(plan)
  self.assertEqual(self.conn.execute("SELECT id,full_name,roll_no FROM students").fetchall(),
   [(1,"จันทร์ O'Neil",3)])
  self.assertEqual(self.conn.execute("SELECT student_id,roll_no FROM student_enrollments").fetchall(),[(1,3)])
  self.assertEqual(self.conn.execute("SELECT password_hash FROM portal_accounts").fetchone()[0],"keep-hash")
  self.assertEqual(self.conn.execute("SELECT status FROM attendance_daily").fetchone()[0],"present")
  self.assertEqual(self.conn.execute("PRAGMA foreign_key_check").fetchall(),[])
  self.apply(mod.plan_rows([self.row("S0001",roll="3",name="จันทร์ O'Neil")],self.snapshot()))
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],1)
 def test_new_student_added_with_current_enrollment_and_idempotent_retry(self):
  rows=[self.row("S0002",roll="2",name="นักเรียนใหม่")]
  plan=mod.plan_rows(rows,self.snapshot())
  self.assertEqual(plan[0]["action"],"add")
  self.apply(plan)
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],2)
  self.assertEqual(self.conn.execute("SELECT student_id,classroom_id,roll_no FROM student_enrollments WHERE student_id=2").fetchone(),(2,1,2))
  self.apply(mod.plan_rows(rows,self.snapshot()))
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],2)
  self.assertEqual(self.conn.execute("PRAGMA foreign_key_check").fetchall(),[])
 def test_bad_data_skipped_but_valid_rows_continue(self):
  rows=[self.row("S0002",roll="1"),self.row("S0003",room="ม.1/2",roll="1"),
        self.row("S0004",room="ไม่พบห้อง",roll="5"),self.row("S0005",roll="2")]
  p=mod.plan_rows(rows,self.snapshot())
  self.assertEqual([r["action"] for r in p],["skip","add","skip","add"])
  self.apply(p)
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],3)
 def test_existing_other_room_is_skipped(self):
  rows=[self.row("S0001",room="ม.1/2",roll="5")]
  self.assertEqual(mod.plan_rows(rows,self.snapshot())[0]["action"],"skip")
 def test_sql_input_cannot_escape_text_literal(self):
  v="Robert'); DELETE FROM students;--"
  plan=mod.plan_rows([self.row("S0033",roll="4",name=v)],self.snapshot())
  self.assertEqual(plan[0]["action"],"add")
  self.apply(plan)
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students").fetchone()[0],2)
  self.assertEqual(self.conn.execute("SELECT full_name FROM students WHERE student_no='S0033'").fetchone()[0],v)
 def test_csv_1750_rows_preserves_leading_zeroes(self):
  with tempfile.TemporaryDirectory() as dir_name:
   file=pathlib.Path(dir_name)/"students.csv"
   with file.open("w",encoding="utf-8-sig",newline="") as handle:
    writer=csv.DictWriter(handle,fieldnames=["classroom","student_no","roll_no","full_name"])
    writer.writeheader()
    for i in range(1750):
     writer.writerow({"classroom":"ม.1/1","student_no":str(i).zfill(7),
       "roll_no":str((i%100)+1),"full_name":"นักเรียน"+str(i)})
   rows=mod.read_csv(file,"utf-8-sig")
   self.assertEqual(len(rows),1750)
   self.assertEqual(rows[0]["student_no"],"0000000")
   self.assertEqual(rows[-1]["source_row"],1751)
 def test_stale_student_slot_cannot_replace_another_student(self):
  plan=mod.plan_rows([self.row("S0002",roll="2")],self.snapshot())
  self.assertEqual(plan[0]["action"],"add")
  self.conn.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('S0099',1,2,'new occupant')")
  self.conn.commit()
  self.apply(plan)
  self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM students WHERE student_no='S0002'").fetchone()[0],0)
if __name__=="__main__":unittest.main()
