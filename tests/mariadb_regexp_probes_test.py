"""Synthetic SQLite GLOB vs MariaDB REGEXP probe construction tests."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "prepare-mariadb-regexp-probes.py"
SPEC = importlib.util.spec_from_file_location("rd_regexp_probes", SCRIPT)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

DATE = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
TIME = "[0-2][0-9]:[0-5][0-9]"


def fixture(pattern_date="^"+DATE+"$", pattern_time="^"+TIME+"$"):
    source = [
        ("behavior_incidents", "CREATE TABLE behavior_incidents("
         "recorded_school_date TEXT CHECK(recorded_school_date IS NULL OR "
         "(length(recorded_school_date)=10 AND recorded_school_date GLOB '"+DATE+"')))"),
        ("school_settings", "CREATE TABLE school_settings("
         "first_period_start_time TEXT CHECK("
         "length(first_period_start_time)=5 AND first_period_start_time GLOB '"+TIME+"'))"),
    ]
    q = chr(96)
    target = {
        "CHECK":[
            ("behavior_incidents", "date_format",
             q+"recorded_school_date"+q+" is null or char_length("+q+"recorded_school_date"+q+") = 10 "
             "and "+q+"recorded_school_date"+q+" regexp '"+pattern_date+"'"),
            ("school_settings", "period_format",
             "char_length("+q+"first_period_start_time"+q+") = 5 and "
             +q+"first_period_start_time"+q+" regexp '"+pattern_time+"'"),
        ]
    }
    return source, target


class RegexpProbesTest(unittest.TestCase):
    def test_matching_synthetic_rule_produces_only_selects(self):
        source, target=fixture()
        rules=module.collect_rules(source,target)
        self.assertEqual(len(rules),2)
        self.assertTrue(all(r["starts_anchored"] and r["ends_anchored"] for r in rules))
        sql=module.generate_sql(rules)
        self.assertIn("SQLITE_EXPECTED",sql)
        self.assertIn("MARIADB_ACTUAL",sql)
        self.assertIn("ORDER BY RESULT, PROBE",sql)
        self.assertNotIn("INSERT INTO",sql)
        self.assertNotIn("DELETE FROM",sql)
        self.assertNotIn("UPDATE ",sql)
        self.assertNotIn("DROP ",sql)
        self.assertEqual(sql.count(" AS SQLITE_EXPECTED"),22)

    def test_unanchored_regexp_is_flagged_not_silently_approved(self):
        source,target=fixture(pattern_date=DATE,pattern_time=TIME)
        rules=module.collect_rules(source,target)
        self.assertTrue(all(not r["starts_anchored"] for r in rules))
        self.assertTrue(all(not r["ends_anchored"] for r in rules))

    def test_rejects_unsafe_sql_from_metadata(self):
        source,target=fixture(pattern_date=DATE+"';DROP TABLE students;--")
        with self.assertRaisesRegex(ValueError,"unsafe_or_unexpected_check_clause"):
            module.collect_rules(source,target)

    def test_source_sqlite_format_expected_results(self):
        rules=module.collect_rules(*fixture())
        bycol={r["column"]:r for r in rules}
        date=bycol["recorded_school_date"]
        time=bycol["first_period_start_time"]
        self.assertEqual(module.expected_sqlite(date,"2026-11-01"),1)
        self.assertEqual(module.expected_sqlite(date,"x2026-11-01"),0)
        self.assertEqual(module.expected_sqlite(date,"2026-11-01x"),0)
        self.assertEqual(module.expected_sqlite(date,"2026/11/01"),0)
        self.assertEqual(module.expected_sqlite(time,"29:59"),1)
        self.assertEqual(module.expected_sqlite(time,"99:59"),0)
        self.assertEqual(module.expected_sqlite(time,"08:30\n"),0)

    def test_new_output_file_is_required(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/"mariadb-regexp-probes.sql"
            module.safe_write(p,"SELECT 1;")
            with self.assertRaisesRegex(ValueError,"new_output_file"):
                module.safe_write(p,"SELECT 2;")


if __name__ == "__main__":
    unittest.main()
