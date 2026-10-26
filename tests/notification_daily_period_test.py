"""Regression tests against the actual D1 SQL for daily/period alert deduplication."""
import pathlib
import re
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
JS = (ROOT / "worker/src/worker.js").read_text(encoding="utf-8")


def query(prefix, occurrence=0):
    """Read the exact prepared SQL from the Worker, not a simplified duplicate."""
    expression = r"env\.DB\.prepare\(`(" + re.escape(prefix) + r"[\s\S]*?)`\)\s*\.bind"
    found = re.findall(expression, JS)
    if len(found) <= occurrence:
        raise AssertionError(f"Worker SQL missing: {prefix} occurrence {occurrence}")
    return found[occurrence]


DAILY = query("INSERT INTO attendance_daily")
PERIOD = query("INSERT INTO attendance_period")
PERIOD_ALERT = query("INSERT INTO attendance_alerts")
ADVISOR_EVENT = query("INSERT INTO notification_outbox")
DAILY_CANCEL = query("UPDATE notification_outbox SET state='cancelled'", 0)
DAILY_RESOLVE = query("UPDATE attendance_alerts SET state='resolved'", 0)
PERIOD_CANCEL = query("UPDATE notification_outbox SET state='cancelled'", 1)
PERIOD_RESOLVE = query("UPDATE attendance_alerts SET state='resolved'", 1)


def database():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for path in ("0001_initial.sql", "0002_notification_outbox.sql"):
        db.executescript((ROOT / "worker/migrations" / path).read_text(encoding="utf-8"))
    db.executescript((ROOT / "worker/demo_seed.sql").read_text(encoding="utf-8"))
    db.execute("INSERT INTO users(username,display_name,role,password_salt,password_hash) "
               "VALUES('class_teacher','Test Teacher','teacher','salt','hash')")
    teacher = db.execute("SELECT id FROM users WHERE username='class_teacher'").fetchone()[0]
    room = db.execute("SELECT id FROM classrooms WHERE grade=1 AND room=1").fetchone()[0]
    student = db.execute("SELECT id FROM students WHERE classroom_id=? LIMIT 1", (room,)).fetchone()[0]
    db.execute("INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,subject) "
               "VALUES(?,?,1,1,'Test Subject')", (room, teacher))
    slot = db.execute("SELECT id FROM timetable WHERE teacher_user_id=?", (teacher,)).fetchone()[0]
    return db, teacher, student, slot


class DailyPeriodAlertTests(unittest.TestCase):
    DATE = "2026-10-26"

    def setUp(self):
        self.db, self.teacher, self.student, self.slot = database()

    def tearDown(self):
        self.db.close()

    def daily(self, status):
        self.db.execute(DAILY, (self.student, self.DATE, status, self.teacher))
        if status == "absent":
            self.db.execute(DAILY_CANCEL, (self.student, self.DATE))
            self.db.execute(DAILY_RESOLVE, (self.student, self.DATE))

    def period(self, status="absent"):
        self.db.execute(PERIOD, (self.student, self.slot, self.DATE, status, self.teacher))
        if status == "absent":
            self.db.execute(PERIOD_ALERT,
                            (self.student, self.slot, self.DATE, self.student, self.DATE))
            self.db.execute(PERIOD_CANCEL, (self.student, self.slot, self.DATE))
            self.db.execute(PERIOD_RESOLVE,
                            (self.student, self.slot, self.DATE, self.student, self.DATE))
            self.db.execute(ADVISOR_EVENT,
                            (self.student, self.slot, self.DATE, self.student, self.DATE))

    def alert_states(self):
        return self.db.execute("SELECT state FROM attendance_alerts").fetchall()

    def outbox_states(self):
        return self.db.execute("SELECT state FROM notification_outbox").fetchall()

    def test_absent_daily_first_does_not_create_advisor_alert(self):
        self.daily("absent")
        self.period("absent")
        self.assertEqual(self.alert_states(), [])
        self.assertEqual(self.outbox_states(), [])
        self.assertEqual(self.db.execute("SELECT status FROM attendance_period").fetchone(), ("absent",))

    def test_absent_daily_after_period_clears_pending_review_and_push(self):
        self.period()
        self.assertEqual(self.alert_states(), [("pending_review",)])
        self.assertEqual(self.outbox_states(), [("pending",)])
        self.daily("absent")
        self.assertEqual(self.alert_states(), [("resolved",)])
        self.assertEqual(self.outbox_states(), [("cancelled",)])
        self.assertEqual(self.db.execute("SELECT status FROM attendance_period").fetchone(), ("absent",))

    def test_repeated_period_checkins_do_not_reopen_suppressed_alert(self):
        self.period()
        self.daily("absent")
        self.period()
        self.assertEqual(self.alert_states(), [("resolved",)])
        self.assertEqual(self.outbox_states(), [("cancelled",)])

    def test_daily_late_leave_present_or_unrecorded_still_request_review(self):
        for status in (None, "present", "late", "leave"):
            with self.subTest(daily=status):
                db, teacher, student, slot = database()
                self.db.close()
                self.db, self.teacher, self.student, self.slot = db, teacher, student, slot
                if status is not None:
                    self.daily(status)
                self.period()
                self.assertEqual(self.alert_states(), [("pending_review",)])
                self.assertEqual(self.outbox_states(), [("pending",)])

    def test_after_daily_correction_from_absent_new_checkin_can_request_review(self):
        self.daily("absent")
        self.period()
        self.daily("present")
        self.period()
        self.assertEqual(self.alert_states(), [("pending_review",)])
        self.assertEqual(self.outbox_states(), [("pending",)])


if __name__ == "__main__":
    unittest.main()
