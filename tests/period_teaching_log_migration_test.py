"""Optional teaching notes must not change period-attendance history."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "worker" / "migrations"


class PeriodTeachingLogMigrationTests(unittest.TestCase):
    def test_optional_note_is_dated_and_independent_of_student_attendance(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript((MIGRATIONS / "0001_initial.sql").read_text(encoding="utf-8"))
        db.execute(
            "INSERT INTO users(id,username,display_name,role,password_salt,password_hash)"
            " VALUES(1,'testteacher','Teacher','teacher','salt','hash')"
        )
        db.execute(
            "INSERT INTO classrooms(id,grade,room,label,advisor_user_id)"
            " VALUES(1,2,4,'ม.2/4',1)"
        )
        db.execute(
            "INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)"
            " VALUES(5,'ST005',1,1,'Sample Student')"
        )
        db.execute(
            "INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)"
            " VALUES(3,1,1,1,2,'วิทยาการคำนวณ')"
        )
        db.execute(
            "INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)"
            " VALUES(5,3,'2026-10-26','present',1)"
        )
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            if migration.name == "0001_initial.sql":
                continue
            db.executescript(migration.read_text(encoding="utf-8"))
        unchanged = db.execute(
            "SELECT status FROM attendance_period"
            " WHERE student_id=5 AND timetable_id=3 AND school_date='2026-10-26'"
        ).fetchone()[0]
        self.assertEqual(unchanged, "present")
        db.execute(
            "INSERT INTO period_teaching_logs(timetable_id,school_date,note,recorded_by)"
            " VALUES(3,'2026-10-26','บทเรียนเรื่องตัวแปร',1)"
        )
        self.assertEqual(
            db.execute("SELECT note FROM period_teaching_logs").fetchone()[0],
            "บทเรียนเรื่องตัวแปร"
        )
        db.execute(
            "UPDATE period_teaching_logs SET note=? WHERE timetable_id=3",
            ("แก้ไขบันทึกการสอน",)
        )
        self.assertEqual(
            db.execute("SELECT note FROM period_teaching_logs").fetchone()[0],
            "แก้ไขบันทึกการสอน"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO period_teaching_logs(timetable_id,school_date,note,recorded_by)"
                " VALUES(3,'2026-10-26','ซ้ำ',1)"
            )
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO period_teaching_logs(timetable_id,school_date,note,recorded_by)"
                " VALUES(3,'2026-10-27',?,1)",
                ("x" * 2001,)
            )
        db.execute(
            "DELETE FROM period_teaching_logs WHERE timetable_id=3 AND school_date='2026-10-26'"
        )
        self.assertEqual(db.execute("SELECT COUNT(*) FROM period_teaching_logs").fetchone()[0], 0)
        self.assertEqual(
            db.execute(
                "SELECT status FROM attendance_period WHERE student_id=5 AND timetable_id=3"
            ).fetchone()[0],
            "present"
        )
        db.close()


if __name__ == "__main__":
    unittest.main()
