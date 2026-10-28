"""Migration regression: student identity and attendance history survive recycled roll numbers."""
import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
MIGRATIONS=ROOT/"worker"/"migrations"
FILE=ROOT/"scripts"/"rebuild_student_roster_on_copy.py"
spec=importlib.util.spec_from_file_location("upgrade_roster_copy", FILE)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class IdentityKeyedRosterMigration(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(":memory:")
  self.db.execute("PRAGMA foreign_keys=ON")
  for f in ("0001_initial.sql","0003_student_transfer_plans.sql",
            "0004_historical_enrollments.sql","0006_student_guardian_portal.sql",
            "0022_admin_account_archive.sql","0030_large_roster_import_lookup.sql"):
   sql=(MIGRATIONS/f).read_text(encoding="utf8")
   if f=="0001_initial.sql":
    # Simulate the older deployed database's embedded room/roll constraint.
    newer=" active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))\n);\nCREATE INDEX IF NOT EXISTS idx_students_room"
    legacy=" active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),\n UNIQUE(classroom_id,roll_no)\n);\nCREATE INDEX IF NOT EXISTS idx_students_room"
    if newer not in sql:
     raise AssertionError("Expected fresh students schema was not found")
    sql=sql.replace(newer,legacy,1)
   self.db.executescript(sql)
  self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'admin','Admin','admin','s','h')")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'ม.1/1')")
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name,active,deleted_at)
   VALUES(10,'archived-student-10',1,1,'ข้อมูลนักเรียนที่ถอนออก #10',0,'2026-10-28')""")
  self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name,active)
   VALUES(11,'20047',1,2,'นักเรียนปัจจุบัน',1)""")
  self.db.execute("""INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date)
   VALUES(10,1,1,'1900-01-01')""")
  self.db.execute("""INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date)
   VALUES(11,1,2,'1900-01-01')""")
  self.db.execute("""INSERT INTO attendance_daily(student_id,school_date,status,recorded_by)
   VALUES(10,'2026-10-02','present',1)""")
  self.db.execute("""INSERT INTO portal_accounts(id,username,display_name,role,student_id,password_salt,password_hash,created_by)
   VALUES(20,'20047','Student','student',11,'salt','hash',1)""")
  self.db.commit()

 def tearDown(self):
  self.db.close()

 def test_identity_and_history_are_preserved_after_copy_upgrade(self):
  with tempfile.TemporaryDirectory() as folder:
   origin=Path(folder)/"backup.sql";output=Path(folder)/"new.sql"
   origin.write_text("\n".join(self.db.iterdump()),encoding="utf8")
   info=module.convert(origin,output)
   self.assertEqual(info["students"],2)
   upgraded=sqlite3.connect(":memory:")
   upgraded.executescript(output.read_text(encoding="utf8"))
   upgraded.execute("PRAGMA foreign_keys=ON")
   self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(),[])
   self.assertEqual(upgraded.execute(
    "SELECT student_id,school_date FROM attendance_daily").fetchall(),[(10,"2026-10-02")])
   self.assertEqual(upgraded.execute(
    "SELECT id,student_no FROM students WHERE id=10").fetchall(),[(10,"archived-student-10")])
   self.assertEqual(upgraded.execute(
    "SELECT student_id FROM portal_accounts WHERE id=20").fetchall(),[(11,)])
   self.assertEqual(upgraded.execute(
    "SELECT end_date FROM student_enrollments WHERE student_id=10").fetchone(),("2026-10-29",))
   upgraded.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('20046',1,1,'New Student')")
   upgraded.execute("INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date) SELECT id,1,1,'2026-10-28' FROM students WHERE student_no='20046'")
   upgraded.commit()
   self.assertEqual(upgraded.execute("PRAGMA foreign_key_check").fetchall(),[])
   with self.assertRaises(sqlite3.IntegrityError):
    upgraded.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('20048',1,2,'Duplicate roll')")
   with self.assertRaises(sqlite3.IntegrityError):
    upgraded.execute("INSERT INTO students(student_no,classroom_id,roll_no,full_name) VALUES('20046',1,3,'Duplicate identity')")
   upgraded.close()

 def test_refuses_to_replace_original_or_run_twice(self):
  with tempfile.TemporaryDirectory() as folder:
   origin=Path(folder)/"backup.sql";out=Path(folder)/"new.sql"
   origin.write_text("\n".join(self.db.iterdump()),encoding="utf8")
   with self.assertRaises(ValueError):
    module.convert(origin,origin)
   module.convert(origin,out)
   with self.assertRaises(ValueError):
    module.convert(origin,out)

if __name__=="__main__":
 unittest.main()
