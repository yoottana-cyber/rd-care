"""SQLite-compatible regression checks for Cloudflare D1 school settings migration."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / 'worker' / 'migrations'


class SchoolSettingsMigrationTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys = ON')
        for file in ('0001_initial.sql', '0024_school_settings.sql'):
            self.db.executescript((MIGRATIONS / file).read_text(encoding='utf-8'))

    def tearDown(self):
        self.db.close()

    def test_default_settings_singleton_and_legacy_data_retained(self):
        row = self.db.execute(
            'SELECT school_name, academic_year, semester, late_cutoff_time, '
            'semester_start_date FROM school_settings WHERE id=1'
        ).fetchone()
        self.assertEqual(row, ('โรงเรียนรัษฎา', 2569, 2, '08:00', None))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM school_settings').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM students').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM classrooms').fetchone()[0], 0)

    def test_replay_safe_and_invalid_semester_rejected(self):
        # IF NOT EXISTS and INSERT OR IGNORE must keep any operator settings.
        self.db.execute("UPDATE school_settings SET late_cutoff_time='08:15' WHERE id=1")
        self.db.executescript((MIGRATIONS / '0024_school_settings.sql').read_text(encoding='utf-8'))
        self.assertEqual(self.db.execute(
            'SELECT late_cutoff_time FROM school_settings WHERE id=1'
        ).fetchone()[0], '08:15')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE school_settings SET semester=4 WHERE id=1")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO school_settings(id) VALUES(2)")

    def test_history_fk_and_audit_schema(self):
        self.db.execute(
            "INSERT INTO users (username,display_name,role,password_salt,password_hash)"
            " VALUES ('admin','ผู้ดูแล','admin','salt','hash')"
        )
        actor = self.db.execute('SELECT id FROM users WHERE username=?', ('admin',)).fetchone()[0]
        self.db.execute(
            'INSERT INTO school_settings_history(actor_id,previous_value,next_value) VALUES(?,?,?)',
            (actor, '{"late_cutoff_time":"08:00"}', '{"late_cutoff_time":"08:15"}')
        )
        self.assertEqual(self.db.execute(
            'SELECT COUNT(*) FROM school_settings_history'
        ).fetchone()[0], 1)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO school_settings_history(actor_id,previous_value,next_value)"
                " VALUES(99999,'{}','{}')"
            )


if __name__ == '__main__':
    unittest.main()
