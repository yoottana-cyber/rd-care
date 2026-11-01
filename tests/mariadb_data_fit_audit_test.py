"""RD CONNECT: synthetic, offline tests for SQLite to MariaDB column value fit."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-sqlite-mariadb-data-fit.py"
spec = importlib.util.spec_from_file_location("audit_mariadb_data_fit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DataFitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.backup = root / "rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
        self.schema = root / "sqlite-schema-summary.json"
        self.mariadb = root / "mariadb-columns-extended.csv"

    def create_synthetic_metadata(self):
        names = [f"fixture_{i:02d}" for i in range(60)] + [
            "students", "student_enrollments", "school_schema_migrations"
        ]
        entries = []
        with sqlite3.connect(self.backup) as conn:
            for name in names:
                conn.execute(
                    'CREATE TABLE "' + name +
                    '"(id INTEGER PRIMARY KEY, note TEXT)'
                )
                value = "school"
                if name == "fixture_00":
                    value = "school-name-is-long"
                if name == "fixture_01":
                    value = None
                key = 130 if name == "fixture_02" else 1
                conn.execute('INSERT INTO "' + name + '" VALUES (?,?)', (key, value))
                entries.append({
                    "table": name, "rows": 1, "columns": [
                        {"name": "id", "type": "INTEGER", "pk": 1},
                        {"name": "note", "type": "TEXT", "pk": 0},
                    ],
                })
        self.schema.write_text(json.dumps({
            "format": module.EXPECTED_REPORT, "table_count": 63,
            "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
            "tables": entries
        }), encoding="utf-8")
        with self.mariadb.open("w", newline="", encoding="utf-8") as output:
            headers = [
                "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "COLUMN_TYPE",
                "IS_NULLABLE", "EXTRA", "CHARACTER_MAXIMUM_LENGTH",
                "NUMERIC_PRECISION", "NUMERIC_SCALE", "DATETIME_PRECISION",
            ]
            writer = csv.DictWriter(output, fieldnames=headers)
            writer.writeheader()
            for name in names:
                if name == "school_schema_migrations":
                    name = "d1_migrations"
                writer.writerow({
                    "TABLE_NAME": name, "COLUMN_NAME": "id", "DATA_TYPE": "tinyint",
                    "COLUMN_TYPE": "tinyint(4)", "IS_NULLABLE": "NO",
                    "EXTRA": "", "CHARACTER_MAXIMUM_LENGTH": "",
                    "NUMERIC_PRECISION": 3, "NUMERIC_SCALE": 0,
                    "DATETIME_PRECISION": "",
                })
                writer.writerow({
                    "TABLE_NAME": name, "COLUMN_NAME": "note",
                    "DATA_TYPE": "varchar", "COLUMN_TYPE": "varchar(10)",
                    "IS_NULLABLE": "NO", "EXTRA": "",
                    "CHARACTER_MAXIMUM_LENGTH": 10, "NUMERIC_PRECISION": "",
                    "NUMERIC_SCALE": "", "DATETIME_PRECISION": "",
                })
                if name == "students":
                    cols = ["live_classroom_id", "live_roll_no"]
                elif name == "student_enrollments":
                    cols = ["current_student_id", "current_classroom_id", "current_roll_no"]
                else:
                    cols = []
                for col in cols:
                    writer.writerow({
                        "TABLE_NAME": name, "COLUMN_NAME": col,
                        "DATA_TYPE": "bigint", "COLUMN_TYPE": "bigint(20)",
                        "IS_NULLABLE": "YES", "EXTRA": "STORED GENERATED",
                        "CHARACTER_MAXIMUM_LENGTH": "", "NUMERIC_PRECISION": 19,
                        "NUMERIC_SCALE": 0, "DATETIME_PRECISION": "",
                    })

    def test_counts_detect_length_null_range_and_never_change_backup(self):
        self.create_synthetic_metadata()
        before = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        result, issues = module.audit(self.backup, self.schema, self.mariadb)
        after = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        self.assertEqual(before, after)
        self.assertEqual(result["tables"], 62)
        self.assertEqual(result["generated_skipped"], 5)
        self.assertEqual(result["fields"], 124)
        self.assertEqual(result["rows"], 62)
        self.assertEqual(result["values"], 124)
        self.assertEqual(result["length"], 1)
        self.assertEqual(result["not_null"], 1)
        self.assertEqual(result["range"], 1)
        self.assertEqual(sum(issues.values()), 3)
        self.assertNotIn("school-name-is-long", str(issues))

    def test_rejects_report_without_matching_row_counts(self):
        self.create_synthetic_metadata()
        obj = json.loads(self.schema.read_text())
        obj["tables"][0]["rows"] = 100
        self.schema.write_text(json.dumps(obj))
        with self.assertRaisesRegex(ValueError, "row_count_disagree"):
            module.audit(self.backup, self.schema, self.mariadb)

    def test_integer_bounds_and_unicode_characters(self):
        self.assertEqual(
            module.analyze_value(255, {
                "nullable": "NO", "type": "tinyint",
                "column_type": "tinyint unsigned", "maxlen": None
            }), None
        )
        self.assertEqual(
            module.analyze_value(256, {
                "nullable": "NO", "type": "tinyint",
                "column_type": "tinyint unsigned", "maxlen": None
            }), "INTEGER_RANGE"
        )
        self.assertEqual(
            module.analyze_value("โรงเรียน", {
                "nullable": "NO", "type": "varchar",
                "column_type": "varchar(8)", "maxlen": 8
            }), None
        )
        self.assertEqual(
            module.analyze_value("โรงเรียนรัษฎา", {
                "nullable": "NO", "type": "varchar",
                "column_type": "varchar(8)", "maxlen": 8
            }), "TEXT_CHARACTER_LENGTH"
        )


if __name__ == "__main__":
    unittest.main()
