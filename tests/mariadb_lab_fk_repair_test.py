"""Synthetic-only schema metadata tests for guarded MariaDB lab FK repair."""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/"scripts"/"prepare-mariadb-lab-fks.py"
spec=importlib.util.spec_from_file_location("lab_fk",SCRIPT)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
TICK=chr(96)


class LabFkRepairTests(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root=Path(temp.name)
        self.source=self.root/"inventory.json"
        names=[f"fixture_{n:02d}" for n in range(62)]+["school_schema_migrations"]
        self.source.write_text(json.dumps({
            "format":"rd-connect-sqlite-backup-inventory-v1",
            "sqlite_integrity":"ok","sqlite_foreign_keys":"ok",
            "table_count":63,"tables":[{"table":n} for n in names]
        }),encoding="utf-8")
        self.tables=mod.schema_tables(self.source)
        self.counts=self.root/"lab-counts.csv"
        self.groups={}
        for i in range(119):
            table=f"fixture_{i%62:02d}"
            name=f"fk_synthetic_{i:03d}"
            parts={1:("parent_id","id")}
            if i<4:
                parts[2]=("year_id","year_id")
            self.groups[table,name]={
                "parent":"fixture_00","update":"RESTRICT",
                "delete":"CASCADE" if i%2 else "RESTRICT",
                "parts":parts
            }

    def counts_csv(self,update=None,omits=None):
        values={("TABLE_ROWS",n):0 for n in self.tables}
        values.update({
            ("TABLE_COUNT","all"):63,("FK_COUNT","all"):0,
            ("GENERATED_COUNT","all"):5,("TRIGGER_COUNT","all"):0
        })
        if update: values.update(update)
        for key in omits or []: values.pop(key,None)
        with self.counts.open("w",newline="",encoding="utf-8") as f:
            w=csv.writer(f)
            w.writerow(["KIND","NAME","N"])
            for (kind,name),value in sorted(values.items()):
                w.writerow([kind,name,value])

    def test_read_only_preflight_sql_targets_lab_and_all_tables(self):
        sql=mod.preflight_sql(self.tables)
        self.assertEqual(sql.count(" AS N"),63)
        self.assertIn(TICK+"ratsadaa_connect_lab"+TICK+"."+TICK+"fixture_00"+TICK,sql)
        self.assertIn("FK_COUNT",sql)
        self.assertIn("GENERATED_COUNT",sql)
        self.assertNotIn("ALTER TABLE",sql)
        self.assertNotIn("INSERT INTO",sql)
        self.assertNotIn("FOREIGN_KEY_CHECKS=0",sql)

    def test_proves_exactly_all_63_tables_are_empty(self):
        self.counts_csv()
        result=mod.verify_preflight(self.counts,self.tables)
        self.assertEqual(len(result),67)
        self.assertEqual(result["FK_COUNT","all"],0)

    def test_rejects_nonempty_table(self):
        self.counts_csv({("TABLE_ROWS","fixture_02"):1})
        with self.assertRaisesRegex(ValueError,"lab_contains_data"):
            mod.verify_preflight(self.counts,self.tables)

    def test_rejects_missing_tables_and_existing_foreign_keys(self):
        self.counts_csv(omits=[("TABLE_ROWS","fixture_01")])
        with self.assertRaisesRegex(ValueError,"incomplete"):
            mod.verify_preflight(self.counts,self.tables)
        self.counts_csv({("FK_COUNT","all"):7})
        with self.assertRaisesRegex(ValueError,"lab_schema_not_ready"):
            mod.verify_preflight(self.counts,self.tables)

    def test_rejects_misleading_schema_metrics(self):
        for key in ["TABLE_COUNT","GENERATED_COUNT","TRIGGER_COUNT"]:
            self.counts_csv({(key,"all"):4})
            with self.assertRaisesRegex(ValueError,"lab_schema_not_ready"):
                mod.verify_preflight(self.counts,self.tables)

    def test_generates_119_lab_only_fk_alters_and_four_composites(self):
        sql=mod.prepare_alters(self.groups,self.tables)
        self.assertEqual(sql.count("ALTER TABLE "),119)
        self.assertIn(TICK+"ratsadaa_connect_lab"+TICK+"."+TICK+"fixture_00"+TICK,sql)
        self.assertIn("ADD CONSTRAINT "+TICK+"fk_synthetic_000"+TICK,sql)
        self.assertIn("FOREIGN KEY ("+TICK+"parent_id"+TICK+", "+TICK+"year_id"+TICK+")",sql)
        self.assertIn("ON UPDATE RESTRICT ON DELETE CASCADE",sql)
        self.assertNotIn("ALTER TABLE "+TICK+"ratsadaa_connect"+TICK+".",sql)
        self.assertNotIn("SET FOREIGN_KEY_CHECKS=0",sql)

    def test_unsupported_actions_or_other_tables_fail(self):
        self.groups["fixture_00","fk_synthetic_000"]["delete"]="SET DEFAULT"
        with self.assertRaisesRegex(ValueError,"unsupported_fk_action"):
            mod.prepare_alters(self.groups,self.tables)
        self.groups["fixture_00","fk_synthetic_000"]["delete"]="RESTRICT"
        self.groups["fixture_00","fk_synthetic_000"]["parent"]="students"
        with self.assertRaisesRegex(ValueError,"fk_points_outside_lab_tables"):
            mod.prepare_alters(self.groups,self.tables)

    def test_new_output_private_path_only(self):
        out=self.root/"new.sql"
        mod.safe_write(out,mod.preflight_sql(self.tables))
        with self.assertRaisesRegex(ValueError,"output_must_be_new_file"):
            mod.safe_write(out,"SELECT 1")


if __name__=="__main__":
    unittest.main()
