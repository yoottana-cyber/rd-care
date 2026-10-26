"""Existing daily absences must clean up stale pending teacher notifications safely."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]/"worker"/"migrations"

def setup():
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript((ROOT/"0001_initial.sql").read_text(encoding="utf-8"))
    db.executescript((ROOT/"0002_notification_outbox.sql").read_text(encoding="utf-8"))
    db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) "
               "VALUES(1,'teacher','Teacher','teacher','salt','hash')")
    db.execute("INSERT INTO classrooms(id,grade,room,label,advisor_user_id) "
               "VALUES(1,1,1,'ม.1/1',1)")
    for sid in (1,2,3):
        db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) "
                   "VALUES(?,?,?,?,?)",(sid,f"ST{sid}",1,sid,f"Student {sid}"))
    db.execute("INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject) "
               "VALUES(1,1,1,1,2,'Subject')")
    for sid in (1,2,3):
        db.execute("INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) "
                   "VALUES(?,1,'2026-10-26','absent',1)",(sid,))
        db.execute("INSERT INTO attendance_alerts(id,student_id,timetable_id,school_date,state) "
                   "VALUES(?,?,1,'2026-10-26','pending_review')",(sid,sid))
        db.execute("INSERT INTO notification_outbox(alert_id,event_type,audience,state) "
                   "VALUES(?,'attendance_review_requested','advisor',?)",
                   (sid,'delivered' if sid==3 else 'pending'))
    for sid,status in [(1,'absent'),(2,'leave'),(3,'absent')]:
        db.execute("INSERT INTO attendance_daily(student_id,school_date,status,recorded_by) "
                   "VALUES(?,'2026-10-26',?,1)",(sid,status))
    return db

class CleanupTests(unittest.TestCase):
    def test_existing_duplicate_alerts_reconciled_without_erasing_period_results(self):
        db=setup()
        try:
            migration=(ROOT/"0012_daily_absence_review_cleanup.sql").read_text(encoding="utf-8")
            db.executescript(migration)
            self.assertEqual(db.execute("SELECT id,state FROM attendance_alerts ORDER BY id").fetchall(),
                             [(1,'resolved'),(2,'pending_review'),(3,'resolved')])
            self.assertEqual(db.execute("SELECT alert_id,state FROM notification_outbox ORDER BY alert_id").fetchall(),
                             [(1,'cancelled'),(2,'pending'),(3,'delivered')])
            self.assertEqual(db.execute("SELECT COUNT(*) FROM attendance_period WHERE status='absent'").fetchone()[0],3)
            db.executescript(migration)
            self.assertEqual(db.execute("SELECT state FROM notification_outbox WHERE alert_id=1").fetchone()[0],'cancelled')
        finally:
            db.close()

if __name__=='__main__':
    unittest.main()
