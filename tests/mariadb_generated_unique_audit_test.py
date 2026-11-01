"""Synthetic generated UNIQUE projection audit. No real students or accounts."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-mariadb-generated-unique.py"
spec = importlib.util.spec_from_file_location("generated_projection_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GeneratedUniqueAuditTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.db = root / "rd-connect-2026-11-01T03-22-03-873Z-fixture.sqlite"
        self.source = root / "sqlite-schema-summary.json"
        self.columns = root / "mariadb-columns-extended.csv"
        self.indexes = root / "mariadb-indexes.csv"
        self.names = [f"fixture_{i:02d}" for i in range(60)] + [
            "students", "student_enrollments", "school_schema_migrations"
        ]
        manifest = []
        with sqlite3.connect(self.db) as db:
            for t in self.names:
                if t == "students":
                    db.execute("""CREATE TABLE students (
                        id INTEGER PRIMARY KEY, classroom_id INTEGER,
                        roll_no INTEGER, deleted_at TEXT)""")
                    db.executemany("INSERT INTO students VALUES (?,?,?,?)", [
                        (1, 10, 1, None), (2, 10, 1, "2026-10-30"),
                        (3, 10, 2, None), (4, 10, 3, None),
                    ])
                    cols = ["id", "classroom_id", "roll_no", "deleted_at"]
                    rows = 4
                elif t == "student_enrollments":
                    db.execute("""CREATE TABLE student_enrollments (
                        id INTEGER PRIMARY KEY, student_id INTEGER,
                        classroom_id INTEGER, roll_no INTEGER, end_date TEXT)""")
                    db.executemany("INSERT INTO student_enrollments VALUES (?,?,?,?,?)", [
                        (1, 1, 10, 1, None), (2, 2, 10, 1, "2026-10-30"),
                        (3, 3, 10, 2, None),
                    ])
                    cols = ["id", "student_id", "classroom_id", "roll_no", "end_date"]
                    rows = 3
                else:
                    db.execute('CREATE TABLE "' + t + '" (id INTEGER PRIMARY KEY)')
                    cols, rows = ["id"], 0
                manifest.append({
                    "table": t, "rows": rows,
                    "columns": [{"name": c, "type": "INTEGER"} for c in cols],
                })
        self.source.write_text(json.dumps({
            "format": "rd-connect-sqlite-backup-inventory-v1",
            "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
            "table_count": 63, "tables": manifest,
        }), encoding="utf-8")
        with self.columns.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["TABLE_NAME", "COLUMN_NAME", "EXTRA"])
            writer.writeheader()
            for t in manifest:
                name = "d1_migrations" if t["table"] == "school_schema_migrations" else t["table"]
                for c in t["columns"]:
                    writer.writerow({
                        "TABLE_NAME": name, "COLUMN_NAME": c["name"], "EXTRA": ""
                    })
                generated = []
                if name == "students":
                    generated = ["live_classroom_id", "live_roll_no"]
                elif name == "student_enrollments":
                    generated = [
                        "current_student_id", "current_classroom_id", "current_roll_no"
                    ]
                for col in generated:
                    writer.writerow({
                        "TABLE_NAME": name, "COLUMN_NAME": col, "EXTRA": "STORED GENERATED"
                    })
        self.records = [
            ("students", "uq_live_room_roll", 1, "live_classroom_id"),
            ("students", "uq_live_room_roll", 2, "live_roll_no"),
            ("student_enrollments", "uq_current_student", 1, "current_student_id"),
            ("student_enrollments", "uq_current_room_roll", 1, "current_classroom_id"),
            ("student_enrollments", "uq_current_room_roll", 2, "current_roll_no"),
        ]
        self.write_indexes()

    def write_indexes(self):
        with self.indexes.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "TABLE_NAME", "INDEX_NAME", "NON_UNIQUE", "SEQ_IN_INDEX",
                "COLUMN_NAME", "SUB_PART", "INDEX_TYPE",
            ])
            writer.writeheader()
            for table, idx, seq, col in self.records:
                writer.writerow({
                    "TABLE_NAME": table, "INDEX_NAME": idx, "NON_UNIQUE": "0",
                    "SEQ_IN_INDEX": str(seq), "COLUMN_NAME": col,
                    "SUB_PART": "NULL", "INDEX_TYPE": "BTREE",
                })

    def audit(self):
        return module.scan(self.db, *module.base.read_metadata(
            self.source, self.columns, self.indexes
        ))

    def test_no_duplicate_when_archived_and_closed_enrollments_excluded(self):
        before = hashlib.sha256(self.db.read_bytes()).hexdigest()
        report = self.audit()
        self.assertEqual(hashlib.sha256(self.db.read_bytes()).hexdigest(), before)
        self.assertEqual(report["expected_indexes"], 3)
        self.assertEqual(report["matched_indexes"], 3)
        self.assertEqual(report["checked_indexes"], 3)
        self.assertEqual(report["exact_duplicate_keys"], 0)
        self.assertEqual(report["potential_casefold_collisions"], 0)
        self.assertEqual(report["active_keys_checked"], 7)
        self.assertFalse(report["safe_to_import"])

    def test_active_room_roll_collision_is_detected(self):
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE students SET roll_no=1 WHERE id=4")
        result = self.audit()
        self.assertEqual(result["exact_duplicate_keys"], 1)

    def test_generated_index_not_in_allowlist_is_unverified_not_checked(self):
        self.records[-1] = (
            "student_enrollments", "uq_current_room_roll", 2, "current_student_id"
        )
        self.write_indexes()
        report = self.audit()
        self.assertEqual(report["matched_indexes"], 2)
        self.assertEqual(report["checked_indexes"], 0)
        self.assertEqual(len(report["unrecognized_indexes"]), 1)


if __name__ == "__main__":
    unittest.main()
