"""Regression checks for non-destructive teacher timetable schema upgrade."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "worker" / "migrations"


class TeacherTimetableMigrationTests(unittest.TestCase):
    def test_upgrade_keeps_legacy_attendance_and_adds_course_metadata(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript((MIGRATIONS / "0001_initial.sql").read_text(encoding="utf-8"))
        db.execute(
            "INSERT INTO users(id,username,display_name,role,password_salt,password_hash)"
            " VALUES(1,'teacher1','ครูตัวอย่าง','teacher','salt','hash')"
        )
        db.execute(
            "INSERT INTO classrooms(id,grade,room,label,advisor_user_id)"
            " VALUES(1,1,1,'ม.1/1',1)"
        )
        db.execute(
            "INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)"
            " VALUES(5,1,1,1,2,'วิทยาการคำนวณ')"
        )
        migrations = {
            2: "notification_outbox", 3: "student_transfer_plans",
            4: "historical_enrollments", 5: "late_self_requests",
            6: "student_guardian_portal", 7: "teacher_timetable",
            8: "teacher_timetable_approvals"
        }
        for number, name in migrations.items():
            db.executescript((MIGRATIONS / f"{number:04d}_{name}.sql").read_text(encoding="utf-8"))
        # Simulate a request waiting under the previous version and one overlapping it.
        db.execute(
            "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,"
            "subject_code,subject,active,approval_status)"
            " VALUES(1,1,3,1,2,'ว22103','วิทยาการคำนวณ',0,'pending')"
        )
        db.execute(
            "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,"
            "subject_code,subject,active,approval_status)"
            " VALUES(1,1,3,2,3,'ว22104','วิทยาการคำนวณเพิ่มเติม',0,'pending')"
        )
        db.executescript((MIGRATIONS / "0009_teacher_timetable_immediate.sql").read_text(encoding="utf-8"))
        states = db.execute(
            "SELECT period,active,approval_status FROM timetable WHERE day_of_week=3 ORDER BY period"
        ).fetchall()
        self.assertEqual(states, [(1,1,'approved'),(2,0,'rejected')])
        lesson = db.execute(
            "SELECT id,period,COALESCE(end_period,period),subject_code,subject"
            " FROM timetable WHERE id=5"
        ).fetchone()
        self.assertEqual(lesson, (5, 2, 2, "", "วิทยาการคำนวณ"))
        self.assertEqual(db.execute("SELECT approval_status FROM timetable WHERE id=5").fetchone()[0], "approved")
        db.execute(
            "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject)"
            " VALUES(1,1,2,1,2,'ว22103','วิทยาการคำนวณ')"
        )
        added = db.execute(
            "SELECT period,end_period,subject_code FROM timetable WHERE day_of_week=2"
        ).fetchone()
        self.assertEqual(added, (1, 2, "ว22103"))
        self.assertEqual(db.execute("SELECT approval_status FROM timetable WHERE day_of_week=2").fetchone()[0], "approved")
        db.close()


if __name__ == "__main__":
    unittest.main()
