"""RD Care D1 notification outbox migration + lifecycle tests (sqlite3)."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


def setup_db():
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript((ROOT / "worker/migrations/0001_initial.sql").read_text(encoding="utf-8"))
    db.executescript((ROOT / "worker/migrations/0002_notification_outbox.sql").read_text(encoding="utf-8"))
    db.executescript((ROOT / "worker/demo_seed.sql").read_text(encoding="utf-8"))
    db.execute(
        "INSERT INTO users(username,display_name,role,password_salt,password_hash) "
        "VALUES('teacher','Demo Teacher','teacher','salt','hash')"
    )
    teacher_id = db.execute("SELECT id FROM users WHERE username='teacher'").fetchone()[0]
    room_id = db.execute("SELECT id FROM classrooms WHERE grade=1 AND room=1").fetchone()[0]
    student_id = db.execute("SELECT id FROM students WHERE classroom_id=? LIMIT 1", (room_id,)).fetchone()[0]
    db.execute(
        "INSERT INTO timetable(classroom_id,teacher_user_id,day_of_week,period,subject) "
        "VALUES(?,?,1,1,'Demo')",
        (room_id, teacher_id),
    )
    timetable_id = db.execute("SELECT id FROM timetable LIMIT 1").fetchone()[0]
    db.execute(
        "INSERT INTO attendance_alerts(student_id,timetable_id,school_date,state) "
        "VALUES(?,?,?,'pending_review')",
        (student_id, timetable_id, "2026-10-26"),
    )
    alert_id = db.execute("SELECT id FROM attendance_alerts LIMIT 1").fetchone()[0]
    return db, alert_id


def advisor_event(db, alert_id):
    db.execute(
        """INSERT INTO notification_outbox(alert_id,event_type,audience,state)
        SELECT id,'attendance_review_requested','advisor','pending'
        FROM attendance_alerts WHERE id=? AND state='pending_review'
        ON CONFLICT(alert_id,event_type,audience) DO UPDATE SET
        state=CASE WHEN notification_outbox.state='cancelled'
                   THEN 'pending' ELSE notification_outbox.state END,
        updated_at=CURRENT_TIMESTAMP""", (alert_id,)
    )


def guardian_event(db, alert_id):
    db.execute(
        """INSERT INTO notification_outbox(alert_id,event_type,audience,state)
        SELECT id,'absence_confirmed','guardian','pending'
        FROM attendance_alerts WHERE id=? AND state='confirmed'
        ON CONFLICT(alert_id,event_type,audience) DO UPDATE SET
        state=CASE WHEN notification_outbox.state='cancelled'
                   THEN 'pending' ELSE notification_outbox.state END,
        updated_at=CURRENT_TIMESTAMP""", (alert_id,)
    )


class NotificationOutboxTests(unittest.TestCase):
    def setUp(self):
        self.db, self.alert_id = setup_db()

    def tearDown(self):
        self.db.close()

    def test_advisor_request_deduplicated_and_guardian_requires_confirmation(self):
        advisor_event(self.db, self.alert_id)
        advisor_event(self.db, self.alert_id)
        guardian_event(self.db, self.alert_id)  # Cannot queue before confirmation.
        self.assertEqual(
            self.db.execute("SELECT audience, state FROM notification_outbox").fetchall(),
            [("advisor", "pending")]
        )
        self.db.execute("UPDATE attendance_alerts SET state='confirmed' WHERE id=?", (self.alert_id,))
        guardian_event(self.db, self.alert_id)
        guardian_event(self.db, self.alert_id)
        self.assertEqual(
            self.db.execute("SELECT audience, state FROM notification_outbox ORDER BY audience").fetchall(),
            [("advisor", "pending"), ("guardian", "pending")]
        )

    def test_correction_cancels_pending_events_without_sending_them(self):
        advisor_event(self.db, self.alert_id)
        self.db.execute("UPDATE attendance_alerts SET state='resolved' WHERE id=?", (self.alert_id,))
        self.db.execute(
            "UPDATE notification_outbox SET state='cancelled' "
            "WHERE state='pending' AND alert_id=?", (self.alert_id,)
        )
        self.assertEqual(
            self.db.execute("SELECT state FROM notification_outbox").fetchone()[0], "cancelled"
        )

    def test_invalid_audience_or_missing_alert_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO notification_outbox(alert_id,event_type,audience) "
                "VALUES(?,?,?)", (self.alert_id, "absence_confirmed", "advisor")
            )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO notification_outbox(alert_id,event_type,audience) "
                "VALUES(?,?,?)", (999999, "absence_confirmed", "guardian")
            )


if __name__ == "__main__":
    unittest.main()
