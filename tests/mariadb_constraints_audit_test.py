"""Synthetic-only RD CONNECT MariaDB constraints audit tests."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-mariadb-constraints.py"
spec = importlib.util.spec_from_file_location("maria_constraint_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConstraintAuditTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.db = root / "rd-connect-2026-11-01T03-22-03-873Z-fixture.sqlite"
        self.manifest = root / "source.json"
        self.csv = root / "mariadb-constraints.csv"
        tables = [f"fixture_{n:02d}" for n in range(60)] + [
            "students", "student_enrollments", "school_schema_migrations"
        ]
        with sqlite3.connect(self.db) as db:
            for table in tables:
                db.execute('CREATE TABLE "' + table + '" (id INTEGER PRIMARY KEY, ' +
                           "amount INTEGER CHECK(amount >= 0))")
            db.execute(
                "CREATE TRIGGER fixture_trigger BEFORE INSERT ON fixture_00 "
                "BEGIN SELECT RAISE(ABORT, 'blocked') WHERE NEW.id = 0; END"
            )
        self.manifest.write_text(json.dumps({
            "format": "rd-connect-sqlite-backup-inventory-v1",
            "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
            "table_count": 63,
            "tables": [{"table": t} for t in tables],
        }))
        self.gen = [
            ("students", "live_classroom_id", "deleted_at", "classroom_id"),
            ("students", "live_roll_no", "deleted_at", "roll_no"),
            ("student_enrollments", "current_student_id", "end_date", "student_id"),
            ("student_enrollments", "current_classroom_id", "end_date", "classroom_id"),
            ("student_enrollments", "current_roll_no", "end_date", "roll_no"),
        ]

    def write(self, add_trigger=False, change_expression=False):
        with self.csv.open("w",newline="") as file:
            writer=csv.DictWriter(file,fieldnames=[
                "ITEM_TYPE","TABLE_NAME","ITEM_NAME","ITEM_VALUE"
            ])
            writer.writeheader()
            for i,(table,col,condition,selected) in enumerate(self.gen):
                expression = (
                    "case when "+chr(96)+condition+chr(96)+" is null then "+
                    chr(96)+selected+chr(96)+" else NULL end"
                )
                if change_expression and i == 0:
                    expression = "1+1"
                writer.writerow({
                    "ITEM_TYPE": "GENERATED", "TABLE_NAME": table,
                    "ITEM_NAME": col, "ITEM_VALUE": expression,
                })
            if add_trigger:
                writer.writerow({
                    "ITEM_TYPE":"TRIGGER","TABLE_NAME":"fixture_00",
                    "ITEM_NAME":"fixture_trigger","ITEM_VALUE":"BEFORE INSERT",
                })

    def test_synthetics_match_and_trigger_gap_is_reported(self):
        self.write(add_trigger=False)
        before=hashlib.sha256(self.db.read_bytes()).digest()
        tables,triggers=module.read_source(self.db,self.manifest)
        report=module.evaluate(tables,triggers,module.read_target(self.csv))
        self.assertEqual(before,hashlib.sha256(self.db.read_bytes()).digest())
        self.assertEqual(report["generated_matched"],5)
        self.assertEqual(report["generated_missing"],[])
        self.assertEqual(report["sqlite_trigger_count"],1)
        self.assertEqual(report["mariadb_trigger_count"],0)
        self.assertEqual(report["sqlite_check_syntax_count"],63)
        self.assertEqual(report["mariadb_check_count"],0)

    def test_synthetic_equivalent_trigger_count_is_identifiable(self):
        self.write(add_trigger=True)
        src,triggers=module.read_source(self.db,self.manifest)
        report=module.evaluate(src,triggers,module.read_target(self.csv))
        self.assertEqual(report["sqlite_trigger_count"],1)
        self.assertEqual(report["mariadb_trigger_count"],1)

    def test_unknown_expression_fails_conservatively(self):
        self.write(change_expression=True)
        src,triggers=module.read_source(self.db,self.manifest)
        report=module.evaluate(src,triggers,module.read_target(self.csv))
        self.assertEqual(report["generated_matched"],4)
        self.assertEqual(
            report["generated_unrecognized_expression"],
            [("students","live_classroom_id")]
        )

    def test_expression_cannot_swap_field(self):
        self.assertFalse(module.generated_matches(
            "students","live_classroom_id",
            "CASE WHEN deleted_at IS NULL THEN roll_no ELSE NULL END"
        ))


if __name__=="__main__":
    unittest.main()
