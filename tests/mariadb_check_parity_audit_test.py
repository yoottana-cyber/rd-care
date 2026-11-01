"""Synthetic tests; CHECK comparison is text evidence, NOT semantic parity."""
import csv
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "audit-mariadb-check-parity.py"
spec = importlib.util.spec_from_file_location("rd_check_text_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckTextAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.db = root / "rd-connect-2026-11-01T03-22-03-fixture.sqlite"
        self.inv = root / "sqlite-inventory.json"
        self.csv = root / "constraints.csv"
        names = [f"fixture_{i:02d}" for i in range(60)] + [
            "students", "student_enrollments", "school_schema_migrations"
        ]
        with sqlite3.connect(self.db) as db:
            for name in names:
                if name == "students":
                    sql = """CREATE TABLE students (
                        id INTEGER PRIMARY KEY,
                        active INTEGER CHECK(active IN(0,1)),
                        score INTEGER CHECK(score > 0 AND (score < 100 OR score IS NULL)),
                        memo TEXT CHECK(memo != 'CHECK(fake)')
                        /* CHECK(comment) must not be extracted */
                    )"""
                else:
                    sql = 'CREATE TABLE "'+name+'" (id INTEGER PRIMARY KEY)'
                db.execute(sql)
        self.inv.write_text(json.dumps({
            "format": "rd-connect-sqlite-backup-inventory-v1",
            "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
            "table_count": 63,
            "tables": [{"table":name} for name in names],
        }), encoding="utf-8")
        self.clauses = [
            ("students", "ck_active", "active IN (0,1)"),
            ("students", "ck_score",
             "(score > 0 and (score < 100 or score is null))"),
            ("students", "ck_memo", "memo != 'CHECK(fake)'"),
        ]
        self.write_csv()

    def write_csv(self):
        with self.csv.open("w", newline="", encoding="utf-8") as stream:
            writer=csv.DictWriter(stream, fieldnames=[
                "ITEM_TYPE","TABLE_NAME","ITEM_NAME","ITEM_VALUE"
            ])
            writer.writeheader()
            for table,name,clause in self.clauses:
                writer.writerow({
                    "ITEM_TYPE":"CHECK","TABLE_NAME":table,
                    "ITEM_NAME":name,"ITEM_VALUE":clause
                })

    def test_syntax_extraction_ignores_strings_and_comments(self):
        ddl="""CREATE TABLE t (x TEXT CHECK(
           x!='CHECK(foo)' AND ((length(x)>1) OR (x IS NULL))
           ), y INT /* CHECK(y<0) */)"""
        clauses=module.sqlite_check_bodies(ddl)
        self.assertEqual(len(clauses),1)
        self.assertIn("length(x)",clauses[0])

    def test_source_backup_parses_and_exact_text_matches(self):
        tables, unused=module.base.read_source(self.db,self.inv)
        report=module.compare(tables,module.base.read_target(self.csv))
        self.assertEqual(report["source_count"],3)
        self.assertEqual(report["dest_count"],3)
        self.assertEqual(report["matched_text"],3)
        self.assertEqual(report["different_counts"],[])
        self.assertEqual(report["review"],[])

    def test_equal_counts_but_different_check_is_flagged(self):
        self.clauses[0]=("students","ck_active","active IN (0,2)")
        self.write_csv()
        tables, unused=module.base.read_source(self.db,self.inv)
        report=module.compare(tables,module.base.read_target(self.csv))
        self.assertEqual(report["source_count"],report["dest_count"])
        self.assertEqual(report["matched_text"],2)
        self.assertEqual(report["different_counts"],[])
        self.assertEqual(report["review"],[("students",1,1)])

    def test_missing_mariadb_check_is_reported(self):
        self.clauses.pop()
        self.write_csv()
        tables, unused=module.base.read_source(self.db,self.inv)
        report=module.compare(tables,module.base.read_target(self.csv))
        self.assertEqual(report["different_counts"],[("students",3,2)])
        self.assertEqual(report["matched_text"],2)


if __name__ == "__main__":
    unittest.main()
