"""Synthetic schema metadata tests. No real SQLite/MariaDB data involved."""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "compare-mariadb-schema.py"
spec = importlib.util.spec_from_file_location("schema_compare", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SchemaCompareTests(unittest.TestCase):
    def test_matches_63_tables_and_detects_missing_or_extra_columns(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            report = root / "sqlite-schema-summary.json"
            target = root / "mariadb-columns.csv"
            tables = [{"table": f"table_{i:02d}", "columns": [
                {"name": "id", "type": "INTEGER", "pk": 1, "hidden": 0},
                {"name": "content", "type": "TEXT", "pk": 0, "hidden": 0},
            ]} for i in range(63)]
            report.write_text(json.dumps({
                "format": module.EXPECTED_FORMAT,
                "sqlite_integrity": "ok",
                "sqlite_foreign_keys": "ok",
                "table_count": 63,
                "tables": tables,
            }))
            with target.open("w", newline="", encoding="utf-8-sig") as output:
                writer = csv.DictWriter(output, fieldnames=[
                    "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE", "EXTRA"])
                writer.writeheader()
                for i in range(63):
                    for col, dtype in (("id", "bigint"), ("content", "text")):
                        writer.writerow({"TABLE_NAME": f"table_{i:02d}",
                            "COLUMN_NAME": col, "DATA_TYPE": dtype,
                            "IS_NULLABLE": "NO", "EXTRA": ""})
            source = module.load_sqlite_report(report)
            dest = module.load_mariadb_csv(target)
            result = module.compare(source, dest)
            self.assertTrue(result["table_and_column_names_match"])
            self.assertEqual(result["missing_tables"], [])
            self.assertEqual(result["missing_columns"], {})
            dest["table_00"].remove("content")
            dest["table_00"].add("renamed_content")
            result = module.compare(source, dest)
            self.assertFalse(result["table_and_column_names_match"])
            self.assertEqual(result["missing_columns"]["table_00"], ["content"])
            self.assertEqual(result["extra_columns"]["table_00"], ["renamed_content"])

    def test_requires_exact_csv_header_not_personal_record_export(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "bad.csv"
            p.write_text("name,student_no,password_hash\nA,100,hash\n")
            with self.assertRaisesRegex(ValueError, "mariadb_csv_columns_required"):
                module.load_mariadb_csv(p)


if __name__ == "__main__":
    unittest.main()
