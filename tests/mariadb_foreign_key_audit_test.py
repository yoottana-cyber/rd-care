"""Synthetic tests for offline SQLite / MariaDB foreign-key preflight."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1]/"scripts"/"audit-mariadb-foreign-keys.py"
spec = importlib.util.spec_from_file_location("mariadb_fk_audit", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ForeignKeyAuditTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.backup = root/"rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
        self.inventory = root/"sqlite-schema-summary.json"
        self.fkcsv = root/"mariadb-fks.csv"
        self.names = [f"fixture_{i:02d}" for i in range(60)] + [
            "students", "student_enrollments", "school_schema_migrations"
        ]
        with sqlite3.connect(self.backup) as db:
            for name in self.names:
                if name == "fixture_01":
                    sql = '''CREATE TABLE fixture_01
                        (id INTEGER PRIMARY KEY, parent_id INTEGER,
                         FOREIGN KEY(parent_id) REFERENCES fixture_00(id)
                         ON UPDATE CASCADE ON DELETE RESTRICT)'''
                elif name == "fixture_02":
                    sql = '''CREATE TABLE fixture_02
                        (id INTEGER PRIMARY KEY, parent_id INTEGER,
                         FOREIGN KEY(parent_id) REFERENCES fixture_00(id)
                         ON UPDATE NO ACTION ON DELETE CASCADE)'''
                else:
                    sql = 'CREATE TABLE "'+name+'" (id INTEGER PRIMARY KEY)'
                db.execute(sql)
            db.execute("INSERT INTO fixture_00(id) VALUES(1)")
            db.execute("INSERT INTO fixture_01 VALUES(1,1)")
            db.execute("INSERT INTO fixture_02 VALUES(1,1)")
        self.inventory.write_text(json.dumps({
            "format": module.SOURCE_FORMAT,
            "sqlite_integrity": "ok", "sqlite_foreign_keys": "ok",
            "table_count": 63,
            "tables":[{"table":name} for name in self.names],
        }), encoding="utf-8")
        self.fkrows = [
            {
                "TABLE_NAME":"fixture_01", "CONSTRAINT_NAME":"fk_first",
                "ORDINAL_POSITION":"1", "COLUMN_NAME":"parent_id",
                "REFERENCED_TABLE_NAME":"fixture_00", "REFERENCED_COLUMN_NAME":"id",
                "UPDATE_RULE":"CASCADE", "DELETE_RULE":"RESTRICT",
            },
            {
                "TABLE_NAME":"fixture_02", "CONSTRAINT_NAME":"fk_second",
                "ORDINAL_POSITION":"1", "COLUMN_NAME":"parent_id",
                "REFERENCED_TABLE_NAME":"fixture_00", "REFERENCED_COLUMN_NAME":"id",
                "UPDATE_RULE":"NO ACTION", "DELETE_RULE":"CASCADE",
            },
        ]
        self.write_csv()

    def write_csv(self):
        with self.fkcsv.open("w",newline="",encoding="utf-8") as output:
            writer=csv.DictWriter(output,fieldnames=[
                "TABLE_NAME","CONSTRAINT_NAME","ORDINAL_POSITION",
                "COLUMN_NAME","REFERENCED_TABLE_NAME","REFERENCED_COLUMN_NAME",
                "UPDATE_RULE","DELETE_RULE",
            ])
            writer.writeheader()
            writer.writerows(self.fkrows)

    def test_same_relationships_with_different_constraint_names(self):
        before = hashlib.sha256(self.backup.read_bytes()).hexdigest()
        names=module.validate_manifest(self.inventory)
        src=module.source_constraints(self.backup,names)
        dest, count, parts=module.target_constraints(self.fkcsv)
        report=module.analyze(src,dest)
        self.assertEqual(report["source_fks"],2)
        self.assertEqual(report["target_fks"],2)
        self.assertEqual(report["missing"],[])
        self.assertEqual(report["extra"],[])
        self.assertEqual(parts,2)
        self.assertEqual(count,2)
        self.assertEqual(hashlib.sha256(self.backup.read_bytes()).hexdigest(),before)

    def test_detects_action_rule_difference(self):
        self.fkrows[0]["DELETE_RULE"]="CASCADE"
        self.write_csv()
        names=module.validate_manifest(self.inventory)
        src=module.source_constraints(self.backup,names)
        dest,*_=module.target_constraints(self.fkcsv)
        report=module.analyze(src,dest)
        self.assertEqual(len(report["missing"]),1)
        self.assertEqual(len(report["extra"]),1)
        self.assertIn("DELETE=RESTRICT",report["missing"][0])
        self.assertIn("DELETE=CASCADE",report["extra"][0])

    def test_mariadb_restrict_is_alias_of_sqlite_no_action_for_immediate_fk(self):
        self.fkrows[1]["UPDATE_RULE"] = "RESTRICT"
        self.write_csv()
        src = module.source_constraints(
            self.backup, module.validate_manifest(self.inventory))
        dest, *unused = module.target_constraints(self.fkcsv)
        report = module.analyze(src, dest)
        self.assertEqual(report["missing"], [])
        self.assertEqual(report["extra"], [])
        self.assertEqual(report["strict_action_differences"], 1)
        self.assertEqual(report["action_alias_only_differences"], 1)

    def test_deferred_fk_declaration_is_flagged_for_manual_review(self):
        with sqlite3.connect(self.backup) as db:
            db.execute("DROP TABLE fixture_03")
            db.execute(
                "CREATE TABLE fixture_03 (id INTEGER PRIMARY KEY, "
                "parent_id INTEGER REFERENCES fixture_00(id) "
                "DEFERRABLE INITIALLY DEFERRED)"
            )
        self.assertEqual(module.deferred_fk_tables(self.backup), ["fixture_03"])

    def test_restrict_semantics_does_not_hide_real_cascade_difference(self):
        self.fkrows[1]["UPDATE_RULE"] = "RESTRICT"
        self.fkrows[1]["DELETE_RULE"] = "RESTRICT"
        self.write_csv()
        src = module.source_constraints(
            self.backup, module.validate_manifest(self.inventory))
        dest, *unused = module.target_constraints(self.fkcsv)
        report = module.analyze(src, dest)
        self.assertEqual(len(report["missing"]), 1)
        self.assertEqual(len(report["extra"]), 1)
        self.assertIn("DELETE=CASCADE", report["missing"][0])

    def test_rejects_csv_without_referenced_columns(self):
        self.fkrows[0]["REFERENCED_COLUMN_NAME"]=""
        self.write_csv()
        with self.assertRaisesRegex(ValueError,"invalid_identifier"):
            module.target_constraints(self.fkcsv)


if __name__=="__main__":
    unittest.main()
