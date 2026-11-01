"""Offline, synthetic unique-index collision tests, no real school records."""
import csv
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).resolve().parents[1]/"scripts"/"audit-mariadb-unique-keys.py"
spec = importlib.util.spec_from_file_location("unique_audit", MODULE)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class IndexAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        p=Path(self.temp.name)
        self.backup=p/"rd-connect-2026-11-01T03-22-03-873Z-test.sqlite"
        self.schema=p/"source.json"
        self.columns=p/"columns.csv"
        self.indexes=p/"indexes.csv"
        self.tables=[f"fixture_{n:02d}" for n in range(60)]+[
            "students","student_enrollments","school_schema_migrations"]
        entries=[]
        with sqlite3.connect(self.backup) as db:
            for t in self.tables:
                db.execute(f'CREATE TABLE "{t}" (id INTEGER, username TEXT)')
                if t=="fixture_00":
                    db.executemany(f'INSERT INTO "{t}" VALUES (?,?)',
                                   [(1,"Alice"),(2,"alice")])
                    n=2
                elif t=="fixture_01":
                    db.executemany(f'INSERT INTO "{t}" VALUES (?,?)',
                                   [(1,"same"),(2,"same")])
                    n=2
                else:
                    db.execute(f'INSERT INTO "{t}" VALUES (?,?)',(1,None))
                    n=1
                entries.append({"table":t,"rows":n,"columns":[
                    {"name":"id","type":"INTEGER"},
                    {"name":"username","type":"TEXT"},
                ]})
        self.schema.write_text(json.dumps({
            "format": "rd-connect-sqlite-backup-inventory-v1",
            "sqlite_integrity":"ok",
            "sqlite_foreign_keys":"ok",
            "table_count":63,
            "tables":entries,
        }),encoding="utf8")
        with self.columns.open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=["TABLE_NAME","COLUMN_NAME","EXTRA"])
            w.writeheader()
            for t in self.tables:
                if t=="school_schema_migrations":
                    t="d1_migrations"
                for col in ["id","username"]:
                    w.writerow({"TABLE_NAME":t,"COLUMN_NAME":col,"EXTRA":""})
                if t=="students":
                    w.writerow({"TABLE_NAME":t,"COLUMN_NAME":"live_roll_no",
                                "EXTRA":"STORED GENERATED"})
        with self.indexes.open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=[
                "TABLE_NAME","INDEX_NAME","NON_UNIQUE","SEQ_IN_INDEX",
                "COLUMN_NAME","SUB_PART","INDEX_TYPE"])
            w.writeheader()
            for t in ["fixture_00","fixture_01","students"]:
                w.writerow({
                    "TABLE_NAME":t,"INDEX_NAME":"uniq_test",
                    "NON_UNIQUE":0,"SEQ_IN_INDEX":1,
                    "COLUMN_NAME": "live_roll_no" if t=="students" else "username",
                    "SUB_PART":"","INDEX_TYPE":"BTREE"
                })

    def test_detects_exact_and_casefold_collisions_skips_generated(self):
        before=hashlib.sha256(self.backup.read_bytes()).digest()
        src, cols, indexes=audit.read_metadata(self.schema,self.columns,self.indexes)
        result=audit.inspect_unique(self.backup,src,cols,indexes)
        after=hashlib.sha256(self.backup.read_bytes()).digest()
        self.assertEqual(before,after)
        self.assertEqual(result["unique_indexes_total"],3)
        self.assertEqual(result["unique_checked"],2)
        self.assertEqual(result["unique_skipped_generated"],1)
        self.assertEqual(result["exact_duplicate_groups"],1)
        self.assertEqual(result["potential_casefold_collisions"],1)
        self.assertEqual(len(result["issues"]),2)
        self.assertNotIn("Alice",str(result["issues"]))
        self.assertNotIn("same",str(result["issues"]))

    def test_ignores_nulls_in_unique_index(self):
        src, cols, indexes=audit.read_metadata(self.schema,self.columns,self.indexes)
        indexes={k:v for k,v in indexes.items() if k[0]=="fixture_02"}
        self.assertEqual(indexes,{})
        # Two NULL values are allowed under MariaDB UNIQUE; test directly.
        with sqlite3.connect(self.backup) as db:
            db.execute("INSERT INTO fixture_00 VALUES (3,NULL)")
            db.execute("INSERT INTO fixture_00 VALUES (4,NULL)")
        src["fixture_00"]["rows"]=4
        src, cols, all_indexes=audit.read_metadata(self.schema,self.columns,self.indexes)
        src["fixture_00"]["rows"]=4
        r=audit.inspect_unique(self.backup,src,cols,all_indexes)
        self.assertEqual(r["exact_duplicate_groups"],1)
        self.assertEqual(r["potential_casefold_collisions"],1)


if __name__=="__main__":
    unittest.main()
