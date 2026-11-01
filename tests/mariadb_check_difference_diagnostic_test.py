"""Synthetic tests for redacted offline CHECK difference diagnostics."""
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "diagnose-mariadb-check-differences.py"
spec = importlib.util.spec_from_file_location("rd_check_difference", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckDifferenceDiagnosticTests(unittest.TestCase):
    def test_redacts_quoted_sql_literals_but_preserves_identifier(self):
        source = "CHECK(role IN ('guardian','student') AND name!='person@example.org')"
        result = module.redact_schema_expression(source)
        self.assertIn("role IN", result)
        self.assertNotIn("guardian", result)
        self.assertNotIn("student", result)
        self.assertNotIn("person@example.org", result)
        self.assertIn("'[literal]'", result)

    def test_detects_different_expressions_even_with_same_count(self):
        tables = [
            ("students", """CREATE TABLE students(
               id INTEGER PRIMARY KEY,
               grade INT CHECK(grade BETWEEN 1 AND 6),
               role TEXT CHECK(role IN ('student','guardian'))
            )"""),
            ("school_schema_migrations", "CREATE TABLE school_schema_migrations(id INTEGER)"),
        ]
        dest = {
            "CHECK":[
                ("students","check_grade","grade BETWEEN 1 AND 6"),
                ("students","check_role","role IN ('student','staff')"),
            ],
            "GENERATED":{}, "TRIGGER":[],
        }
        result = module.differences(tables,dest)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0][0],"students")
        self.assertEqual(len(result[0][1]),1)
        sqlite_expr,name,maria_expr=result[0][1][0]
        self.assertEqual(name,"check_role")
        self.assertIn("guardian",sqlite_expr)
        self.assertIn("staff",maria_expr)
        self.assertNotIn("guardian",module.redact_schema_expression(sqlite_expr))
        self.assertNotIn("staff",module.redact_schema_expression(maria_expr))

    def test_no_differences_for_identical_expressions(self):
        tables=[("students", "CREATE TABLE students(id INT CHECK(id > 0))")]
        target={"CHECK":[("students","positive_id","id>0")]}
        self.assertEqual(module.differences(tables,target),[])

    def test_missing_mariadb_check_is_not_hidden(self):
        tables=[("students", "CREATE TABLE students(id INT CHECK(id > 0))")]
        target={"CHECK":[]}
        report=module.differences(tables,target)
        self.assertEqual(len(report),1)
        self.assertEqual(report[0][1][0][1:],(None,None))


if __name__ == "__main__":
    unittest.main()
