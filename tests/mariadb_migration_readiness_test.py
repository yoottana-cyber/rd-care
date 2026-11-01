"""Synthetic metadata; no production student data used."""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-mariadb-migration-readiness.py"
spec = importlib.util.spec_from_file_location("migration_readiness", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MigrationReadinessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.source = root / "source.json"
        self.target = root / "target.csv"
        self.sql = {}
        for i in range(62):
            self.sql["table_%02d" % i] = {
                "id": {"name": "id", "type": "INTEGER", "pk": 1, "hidden": 0},
                "school_date": {"name": "school_date", "type": "TEXT", "pk": 0, "hidden": 0},
            }
        self.sql["students"] = {
            "id": {"name": "id", "type": "INTEGER"},
            "name": {"name": "name", "type": "TEXT"},
        }
        # 62 generic tables + students + migration ledger = 64.
        del self.sql["table_61"]
        self.sql[module.OLD_LEDGER] = {
            "filename": {"name": "filename", "type": "TEXT"},
        }
        assert len(self.sql) == 63
        self.destination = {}
        for name, cols in self.sql.items():
            if name == module.OLD_LEDGER:
                continue
            self.destination[name] = {
                col: {
                    "type": ("bigint" if meta["type"] == "INTEGER" else "varchar"),
                    "nullable": "NO", "extra": ""
                } for col, meta in cols.items()
            }
        self.destination[module.NEW_LEDGER] = {
            "id": {"type": "bigint", "nullable": "NO", "extra": "auto_increment"},
            "name": {"type": "varchar", "nullable": "NO", "extra": ""},
            "applied_at": {"type": "datetime", "nullable": "NO", "extra": ""}
        }
        self.destination["students"].update({
            col: {"type": "bigint", "nullable": "YES", "extra": "STORED GENERATED"}
            for col in module.GENERATED["students"]
        })
        # Add student_enrollments in place of a generic table; keep 63 count.
        self.sql["student_enrollments"] = self.sql.pop("table_60")
        self.destination["student_enrollments"] = self.destination.pop("table_60")
        self.destination["student_enrollments"].update({
            col: {"type": "bigint", "nullable": "YES", "extra": "STORED GENERATED"}
            for col in module.GENERATED["student_enrollments"]
        })

    def write(self):
        self.source.write_text(json.dumps({
            "format": module.FORMAT, "sqlite_integrity": "ok",
            "sqlite_foreign_keys": "ok", "table_count": len(self.sql),
            "tables": [
                {"table": name, "columns": list(cols.values())}
                for name, cols in self.sql.items()
            ],
        }), encoding="utf-8")
        with self.target.open("w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE", "EXTRA"
            ])
            writer.writeheader()
            for name, cols in self.destination.items():
                for col, meta in cols.items():
                    writer.writerow({
                        "TABLE_NAME": name, "COLUMN_NAME": col,
                        "DATA_TYPE": meta["type"],
                        "IS_NULLABLE": meta["nullable"],
                        "EXTRA": meta["extra"],
                    })

    def test_generated_columns_and_ledger_handled_without_modifying_files(self):
        self.write()
        before = self.source.read_bytes(), self.target.read_bytes()
        report = module.audit(*module.inspect_sources(self.source, self.target))
        self.assertEqual(report["generated_columns_verified"], 5)
        self.assertEqual(report["structural_blockers"], [])
        self.assertEqual(report["type_family_mismatches"], [])
        self.assertFalse(report["ready_for_automated_import"])
        self.assertEqual((self.source.read_bytes(), self.target.read_bytes()), before)

    def test_non_generated_extra_column_is_blocker(self):
        self.destination["students"]["live_roll_no"]["extra"] = ""
        self.write()
        report = module.audit(*module.inspect_sources(self.source, self.target))
        self.assertTrue(any("not_generated" in s for s in report["structural_blockers"]))

    def test_text_to_datetime_requires_review(self):
        self.destination["student_enrollments"]["school_date"]["type"] = "datetime"
        self.write()
        report = module.audit(*module.inspect_sources(self.source, self.target))
        self.assertEqual(report["type_family_mismatches"], [])
        self.assertTrue(any("school_date" in x for x in report["date_text_conversions"]))


if __name__ == "__main__":
    unittest.main()
