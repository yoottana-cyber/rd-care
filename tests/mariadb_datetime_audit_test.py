"""Tests RD CONNECT pre-import date audit with synthetic data only."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-sqlite-datetime.py"
spec = importlib.util.spec_from_file_location("audit_sqlite_datetime", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SqliteDateAuditTest(unittest.TestCase):
    def test_date_parser(self):
        cases = {
            "2026-11-01 03:22:03": ("naive_space", False),
            "2026-11-01T03:22:03.873Z": ("utc_z", True),
            "2026-11-01T10:22:03+07:00": ("offset", False),
            "2026-02-29 03:22:03": ("invalid", False),
            "9999-12-31T23:59:59-02:00": ("out_of_range", False),
            "": ("blank", False),
            "1970-01-01": ("invalid", False),
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(module.assess_time(value, True), expected)
        self.assertEqual(module.assess_time(None, False), ("null", False))
        self.assertEqual(module.assess_time(None, True), ("null_violation", False))

    def test_read_only_backup_scans_and_hides_values(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            backup = root / "rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
            inventory = root / "schema.json"
            csvfile = root / "columns.csv"
            with sqlite3.connect(backup) as db:
                db.executescript("""
                    CREATE TABLE events (id INTEGER PRIMARY KEY,
                        created_at TEXT NOT NULL, reviewed_at TEXT);
                    INSERT INTO events VALUES
                        (1, '2026-11-01T03:22:03.873Z', NULL),
                        (2, '2026-11-01 03:22:03', 'bad-value');
                """)
            entries = [{
                "table": "events",
                "columns": [
                    {"name": "id", "type": "INTEGER"},
                    {"name": "created_at", "type": "TEXT"},
                    {"name": "reviewed_at", "type": "TEXT"},
                ],
            }]
            entries += [{
                "table": "other_%02d" % i,
                "columns": [{"name": "id", "type": "INTEGER"}],
            } for i in range(62)]
            inventory.write_text(json.dumps({
                "format": module.EXPECTED_FORMAT, "table_count": 63,
                "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
                "tables": entries,
            }))
            with csvfile.open("w", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=[
                    "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE",
                    "IS_NULLABLE", "EXTRA",
                ])
                writer.writeheader()
                for table in entries:
                    for col in table["columns"]:
                        writer.writerow({
                            "TABLE_NAME": table["table"],
                            "COLUMN_NAME": col["name"],
                            "DATA_TYPE": (
                                "datetime" if col["name"].endswith("_at")
                                else "bigint"
                            ),
                            "IS_NULLABLE": (
                                "NO" if col["name"] == "created_at" else "YES"
                            ),
                            "EXTRA": "",
                        })
            before = hashlib.sha256(backup.read_bytes()).hexdigest()
            fields, counts, review = module.scan(backup, inventory, csvfile)
            after = hashlib.sha256(backup.read_bytes()).hexdigest()
            self.assertEqual(before, after)
            self.assertEqual(fields, 2)
            self.assertEqual(counts["total"], 4)
            self.assertEqual(counts["utc_z"], 1)
            self.assertEqual(counts["fractional"], 1)
            self.assertEqual(counts["invalid"], 1)
            self.assertEqual(counts["null"], 1)
            self.assertNotIn("bad-value", str(review))


if __name__ == "__main__":
    unittest.main()
