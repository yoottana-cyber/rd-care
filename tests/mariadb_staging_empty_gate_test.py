"""RD CONNECT staging empty gate: synthetic metadata and CSV only."""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check-mariadb-staging-empty.py"
spec = importlib.util.spec_from_file_location("empty_gate", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StagingEmptyTest(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        self.source = self.dir / "metadata.json"
        self.csv = self.dir / "mariadb-staging-counts.csv"
        names = [f"fixture_{n:02d}" for n in range(62)] + [
            "school_schema_migrations"
        ]
        self.source.write_text(json.dumps({
            "format": module.BACKUP_FORMAT,
            "sqlite_integrity":"ok","sqlite_foreign_keys":"ok",
            "table_count":63,
            "tables":[{"table":name} for name in names],
        }),encoding="utf-8")
        self.tables = module.expected_tables(self.source)

    def write_csv(self, nonempty=None):
        nonempty = nonempty or {}
        with self.csv.open("w",newline="") as stream:
            writer = csv.DictWriter(stream,fieldnames=["TABLE_NAME","ROW_COUNT"])
            writer.writeheader()
            for name in self.tables:
                writer.writerow({
                    "TABLE_NAME":name, "ROW_COUNT":nonempty.get(name,0)
                })

    def test_sql_only_counts_63_and_no_writes(self):
        sql = module.generate_sql(self.tables,"ratsadaa_connect")
        self.assertEqual(sql.count("COUNT(*)"), 63)
        self.assertNotIn("INSERT", sql)
        self.assertNotIn("UPDATE",sql)
        self.assertNotIn("DELETE",sql)
        self.assertNotIn("DROP",sql)
        self.assertNotIn("CREATE",sql)
        self.assertIn("d1_migrations",sql)
        self.assertNotIn("school_schema_migrations",sql)

    def test_refuses_other_database(self):
        with self.assertRaisesRegex(ValueError,"unapproved_staging_schema"):
            module.generate_sql(self.tables,"ratsadaa_connect_production")

    def test_full_csv_verification_and_nonempty_detection(self):
        self.write_csv()
        result=module.verify_csv(self.tables,self.csv)
        self.assertEqual(result["tables"],63)
        self.assertEqual(result["empty_tables"],63)
        self.assertEqual(result["non_empty"],[])
        self.write_csv({"fixture_01":11})
        result=module.verify_csv(self.tables,self.csv)
        self.assertEqual(result["non_empty"],[("fixture_01",11)])
        self.assertEqual(result["total_rows"],11)

    def test_missing_table_blocked(self):
        self.write_csv()
        rows=list(csv.DictReader(self.csv.open()))
        with self.csv.open("w",newline="") as out:
            writer=csv.DictWriter(out,fieldnames=["TABLE_NAME","ROW_COUNT"])
            writer.writeheader()
            writer.writerows(rows[1:])
        with self.assertRaisesRegex(ValueError,"tables_missing_or_extra"):
            module.verify_csv(self.tables,self.csv)

    def test_sql_file_must_be_new(self):
        dest = self.dir/"read_only.sql"
        module.safe_write_sql(dest,module.generate_sql(self.tables,"ratsadaa_connect"))
        with self.assertRaisesRegex(ValueError,"output_must_be_new_file"):
            module.safe_write_sql(dest,"SELECT 1")


if __name__=="__main__":
    unittest.main()
