"""Synthetic-only staging import planner tests. No real school rows or DB writes."""
import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "plan-mariadb-staging-import.py"
spec = importlib.util.spec_from_file_location("maria_plan", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class MariaStagingPlanTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)
        self.report = self.dir / "sqlite-schema-summary.json"
        self.cols = self.dir / "mariadb-columns-extended.csv"
        self.fks = self.dir / "mariadb-foreign-keys.csv"
        names = [f"fixture_{i:02d}" for i in range(59)] + [
            "classrooms", "students", "student_enrollments", "school_schema_migrations",
        ]
        self.tables = []
        for table in names:
            cols = [{"name": "id", "type": "INTEGER"}]
            parents = []
            count = 1
            if table == "students":
                cols += [{"name":"classroom_id","type":"INTEGER"},
                         {"name":"roll_no","type":"INTEGER"},
                         {"name":"deleted_at","type":"TEXT"}]
                parents = [{"parent_table":"classrooms","parent_column":"id",
                            "child_column":"classroom_id"}]
                count = 2
            elif table == "student_enrollments":
                cols += [{"name":"student_id","type":"INTEGER"},
                         {"name":"classroom_id","type":"INTEGER"},
                         {"name":"roll_no","type":"INTEGER"},
                         {"name":"end_date","type":"TEXT"}]
                # A synthetic fixture for cardinality: 122 parts, all reference students
                parents = [{"parent_table":"students","parent_column":"id",
                            "child_column":"student_id"} for i in range(122)]
                count = 2
            elif table == "school_schema_migrations":
                count = 46
            self.tables.append({
                "table":table, "columns":cols,
                "foreign_keys":parents, "rows":count,
            })
        self.report.write_text(json.dumps({
            "format": module.FORMAT,
            "sqlite_integrity":"ok", "sqlite_foreign_keys":"ok",
            "table_count":63, "tables":self.tables,
        }), encoding="utf-8")
        with self.cols.open("w",encoding="utf-8",newline="") as f:
            writer=csv.DictWriter(f,fieldnames=sorted(module.COLUMNS_REQUIRED))
            writer.writeheader()
            for table in self.tables:
                name=("d1_migrations" if
                      table["table"]=="school_schema_migrations" else table["table"])
                for col in table["columns"]:
                    writer.writerow({"TABLE_NAME":name,"COLUMN_NAME":col["name"],
                                     "EXTRA":"","DATA_TYPE":"integer"})
                for gen in sorted(module.EXPECTED_GENERATED.get(name,[])):
                    writer.writerow({"TABLE_NAME":name,"COLUMN_NAME":gen,
                                     "EXTRA":"STORED GENERATED","DATA_TYPE":"bigint"})
        self.fkrows = []
        def make_fk(table, idx, parent, child_col, count):
            for ordinal in range(1,count+1):
                self.fkrows.append({
                    "TABLE_NAME":table,"CONSTRAINT_NAME":f"fk_{idx}",
                    "ORDINAL_POSITION":ordinal, "COLUMN_NAME":child_col,
                    "REFERENCED_TABLE_NAME":parent, "REFERENCED_COLUMN_NAME":"id",
                    "UPDATE_RULE":"RESTRICT", "DELETE_RULE":"RESTRICT",
                })
        make_fk("students",1,"classrooms","classroom_id",1)
        for k in range(118):
            make_fk("student_enrollments",k+2,"students","student_id",
                    5 if k==0 else 1)
        self.write_fks()

    def write_fks(self):
        with self.fks.open("w", encoding="utf8", newline="") as f:
            writer = csv.DictWriter(f,fieldnames=sorted(module.FKS_REQUIRED))
            writer.writeheader()
            writer.writerows(self.fkrows)

    def test_parent_first_plan_excludes_ledgers_and_generated_columns(self):
        source = module.read_sqlite_inventory(self.report)
        target = module.read_target_columns(self.cols)
        fks = module.read_target_fk_parts(self.fks)
        plan = module.plan(source,target,fks)
        self.assertEqual(plan["tables_to_import"],62)
        self.assertEqual(plan["source_rows_to_import"],63)
        self.assertEqual(plan["source_foreign_key_parts"],123)
        self.assertEqual(plan["target_foreign_key_parts"],123)
        self.assertEqual(plan["ready_for_fk_ordered_import"],True)
        self.assertEqual(plan["cycles"],[])
        self.assertEqual(plan["self_referencing_tables"],[])
        self.assertFalse(plan["import_authorized"])
        names = [row["table"] for row in plan["insert_steps"]]
        self.assertEqual(len(names),62)
        self.assertLess(names.index("classrooms"),names.index("students"))
        self.assertLess(names.index("students"),names.index("student_enrollments"))
        self.assertNotIn("school_schema_migrations",names)
        self.assertEqual(
            plan["generated_columns_excluded"]["student_enrollments"],
            sorted(module.EXPECTED_GENERATED["student_enrollments"])
        )

    def test_cycles_block_ordered_import(self):
        source = module.read_sqlite_inventory(self.report)
        target = module.read_target_columns(self.cols)
        fk = module.read_target_fk_parts(self.fks)
        source["classrooms"]["parents"].add("students")
        # destination table pair exists for student->classrooms; now also classroom->student
        fk[("classrooms","added")] = {"parent":"students","columns":{1:("id","id")}}
        # 124 FK parts: this fails safe rather than inventing an import order.
        with self.assertRaisesRegex(ValueError,"target_fk_parts_mismatch"):
            module.plan(source,target,fk)
        # Test cycle detector directly, independent of total cardinality checks.
        data = {k:v for k,v in source.items() if k!="school_schema_migrations"}
        order,cycles,selfrefs = module.topological_order(data)
        self.assertIn("classrooms",cycles)
        self.assertIn("students",cycles)
        self.assertIn("student_enrollments",cycles)
        self.assertFalse(selfrefs)

    def test_self_referencing_fks_are_flagged(self):
        info = {
            "students":{"parents":{"students"}},
            "classrooms":{"parents":set()},
        }
        order,cycles,selfrefs=module.topological_order(info)
        self.assertEqual(cycles,[])
        self.assertEqual(selfrefs,["students"])
        self.assertEqual(len(order),2)

    def test_report_saved_only_outside_repo(self):
        dest=self.dir/"plan.json"
        module.safe_save(dest,{"import_authorized":False})
        self.assertFalse(json.loads(dest.read_text())["import_authorized"])
        with self.assertRaisesRegex(ValueError,"output_must_be_new_file"):
            module.safe_save(dest,{"import_authorized":True})


if __name__ == "__main__":
    unittest.main()
