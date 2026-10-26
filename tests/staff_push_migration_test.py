"""SQLite D1 migration for staff-only push subscriptions."""
import sqlite3
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1] / "worker" / "migrations"


class StaffPushMigration(unittest.TestCase):
    def test_push_endpoint_is_unique_per_device_and_cascades_on_logout_account_removal(self):
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "0001_initial.sql").read_text(encoding="utf-8"))
        db.executescript((ROOT / "0002_notification_outbox.sql").read_text(encoding="utf-8"))
        db.executescript((ROOT / "0011_staff_web_push.sql").read_text(encoding="utf-8"))
        db.execute("PRAGMA foreign_keys=ON")
        for user_id in (1, 2):
            db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash)"
                " VALUES(?,?,?,?,?,?)", (user_id,f"teacher{user_id}",f"Teacher {user_id}","teacher","salt","hash"))
        endpoint = "https://fcm.googleapis.com/fcm/send/devtokenexample"
        db.execute("INSERT INTO staff_push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(?,?,?,?)",
            (1,endpoint,"p256dh","auth"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("INSERT INTO staff_push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(?,?,?,?)",
                (2,endpoint,"p256dh","auth"))
        db.execute("DELETE FROM users WHERE id=1")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM staff_push_subscriptions").fetchone()[0],0)
        db.close()

if __name__ == "__main__":
    unittest.main()
