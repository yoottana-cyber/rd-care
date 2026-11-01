"""Synthetic, offline tests: no real RD CONNECT user or student information."""
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sqlite-backup-inventory.py"
spec = importlib.util.spec_from_file_location("sqlite_backup_inventory", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BackupInventoryTests(unittest.TestCase):
    def test_counts_and_schema_without_personal_rows_or_changes(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
            with sqlite3.connect(source) as connection:
                connection.executescript("""
                    PRAGMA foreign_keys=ON;
                    CREATE TABLE users (
                        id INTEGER PRIMARY KEY, username TEXT,
                        password_hash TEXT NOT NULL
                    );
                    CREATE TABLE students (
                        id INTEGER PRIMARY KEY,
                        full_name TEXT NOT NULL,
                        advisor_user_id INTEGER REFERENCES users(id)
                    );
                    INSERT INTO users VALUES(1,'private-username','SECRET-SALT-HASH');
                    INSERT INTO students VALUES(1,'Private Student Name',1);
                """)
            initial = hashlib.sha256(source.read_bytes()).hexdigest()
            result = module.inspect_backup(str(source))
            final = hashlib.sha256(source.read_bytes()).hexdigest()

            self.assertEqual(initial, final)
            self.assertEqual(result["sqlite_integrity"], "ok")
            self.assertEqual(result["sqlite_foreign_keys"], "ok")
            self.assertEqual(result["table_count"], 2)
            self.assertEqual(result["selected_counts"]["users"], 1)
            self.assertEqual(result["selected_counts"]["students"], 1)
            output = json.dumps(result)
            self.assertNotIn("private-username", output)
            self.assertNotIn("Private Student Name", output)
            self.assertNotIn("SECRET-SALT-HASH", output)
            self.assertIn("full_name", output)

    def test_rejects_live_database_name(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "rd-connect.sqlite"
            sqlite3.connect(source).close()
            with self.assertRaisesRegex(ValueError, "verified_backup_filename_required"):
                module.inspect_backup(str(source))

    def test_rejects_foreign_key_inconsistency(self):
        with tempfile.TemporaryDirectory() as root:
            source = Path(root) / "rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
            with sqlite3.connect(source) as conn:
                conn.executescript("""
                    CREATE TABLE p(id INTEGER PRIMARY KEY);
                    CREATE TABLE c(id INTEGER PRIMARY KEY,
                      parent INTEGER REFERENCES p(id));
                    INSERT INTO c VALUES (1,999);
                """)
            with self.assertRaisesRegex(ValueError, "backup_foreign_keys_failed"):
                module.inspect_backup(str(source))


if __name__ == "__main__":
    unittest.main()
