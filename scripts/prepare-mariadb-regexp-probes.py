#!/usr/bin/env python3
"""Generate MariaDB read-only SELECT probes for two SQLite GLOB -> REGEXP checks.

Source: verified SQLite backup (schema only) + metadata-only MariaDB CSV.
Output: synthetic test values and known SQLite GLOB outcomes. No DB access
except immutable, query-only SQLite backup; NO UPDATE/INSERT/DDL/MariaDB links.
A passing synthetic probe is NOT a general semantic-equivalence proof.
"""
import argparse
import csv
import importlib.util
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "rd_check_parity", HERE/"audit-mariadb-check-parity.py")
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)

RULES = {
    ("behavior_incidents", "recorded_school_date"): {
        "glob": "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]",
        "length": 10,
        "case_prefix": "behavior_date",
        "samples": ["2026-11-01", "2026-99-99", "2026-11-1",
                    "2026-11-01x", "x2026-11-01", "2026/11/01",
                    "2026-11-01\n", "9999-12-31", "2026-1a-01",
                    "２０２６-11-01"],
    },
    ("school_settings", "first_period_start_time"): {
        "glob": "[0-2][0-9]:[0-5][0-9]",
        "length": 5,
        "case_prefix": "start_time",
        "samples": ["08:30", "29:59", "00:00", "30:59", "99:59",
                    "8:30", "08:3", "08:30x", "x08:30",
                    "08:30\n", "08-30", "๐8:30"],
    },
}
# The entire MariaDB REGEXP literal must be plain pattern characters.
# Prevent accidental injection of any SQL/semicolon/backtick/quote into SQL.
SAFE_PATTERN = re.compile(r"[A-Za-z0-9\[\]{}()^$.:+*?\\\-_]+")
REGEXP_EXTRACT = re.compile(r"\bREGEXP\s*'([^']+)'", re.I)
GLOB_EXTRACT = re.compile(r"\bGLOB\s*'([^']+)'", re.I)


def collect_rules(sqlite_tables, target):
    source_by_table = dict(sqlite_tables)
    dest_by_table = {}
    for table, _, clause in target["CHECK"]:
        dest_by_table.setdefault(table, []).append(clause)

    found = []
    for (table, col), config in RULES.items():
        body = []
        for expr in check.sqlite_check_bodies(source_by_table.get(table) or ""):
            if re.search(r"\b"+re.escape(col)+r"\s+GLOB\b", expr, re.I):
                body.append(expr)
        matches = []
        for expr in body:
            match = GLOB_EXTRACT.search(expr)
            if match and match.group(1) == config["glob"]:
                matches.append(expr)
        if len(matches) != 1 or len(body) != 1:
            raise ValueError("unexpected_sqlite_glob_constraint")
        target_regex = []
        for clause in dest_by_table.get(table, []):
            if re.search(r"\b"+re.escape(col)+r"\s+REGEXP\b", clause, re.I):
                match = REGEXP_EXTRACT.search(clause)
                if not match:
                    raise ValueError("unexpected_regexp_clause")
                target_regex.append((clause, match.group(1)))
        if len(target_regex) != 1:
            raise ValueError("missing_or_multiple_target_regexp")
        clause, pattern = target_regex[0]
        if not SAFE_PATTERN.fullmatch(pattern) or len(pattern) > 128:
            raise ValueError("unsafe_regexp_pattern")
        # Only known semantics: nullable behavior_date, required school first time.
        # Require that the exported rule uses CHAR_LENGTH and target REGEXP,
        # to ensure probe SQL exercises the same basic predicate family.
        canonical = check.canonical(clause)
        if "char_length("+col+")="+str(config["length"]) not in canonical:
            raise ValueError("unexpected_regexp_length_constraint")
        if table == "behavior_incidents" and col+"isnullor" not in canonical:
            raise ValueError("unexpected_nullable_date_constraint")
        found.append({
            "table":table, "column":col, "glob":config["glob"],
            "pattern":pattern, "length":config["length"],
            "case_prefix":config["case_prefix"],
            "samples":config["samples"],
            "starts_anchored":pattern.startswith("^") or pattern.startswith("\\A"),
            "ends_anchored":pattern.endswith("$") or pattern.endswith("\\z") or pattern.endswith("\\Z"),
        })
    return found


def expected_sqlite(rule, value):
    with sqlite3.connect(":memory:") as db:
        val = db.execute(
            "SELECT CAST((length(?)=? AND ? GLOB ?) AS INTEGER)",
            (value, rule["length"], value, rule["glob"])
        ).fetchone()[0]
    return val


def sql_literal(value):
    # Only controlled probes declared above; no actual student data.
    return "'" + value.replace("'", "''") + "'"


def generate_sql(rules):
    if len(rules) != 2:
        raise ValueError("two_rules_required")
    parts = []
    for rule in rules:
        col = rule["column"]
        if not re.fullmatch(r"[a-z_]+", col):
            raise ValueError("bad_column_name")
        pattern = rule["pattern"]
        # Safe literal already checked by collect_rules.
        if not SAFE_PATTERN.fullmatch(pattern):
            raise ValueError("unsafe_regexp_pattern")
        for i, value in enumerate(rule["samples"]):
            case = sql_literal(rule["case_prefix"]+"_"+str(i+1))
            expected = expected_sqlite(rule, value)
            text = sql_literal(value)
            expr = (
                "CHAR_LENGTH("+text+")="+str(rule["length"])+
                " AND "+text+" REGEXP "+sql_literal(pattern)
            )
            parts.append(
                "SELECT "+case+" AS PROBE, "+str(expected)+
                " AS SQLITE_EXPECTED, CAST(("+expr+
                ") AS UNSIGNED) AS MARIADB_ACTUAL"
            )
    all_rows = "\nUNION ALL\n".join(parts)
    return (
        "-- READ ONLY synthetic GLOB / REGEXP format probes.\n"
        "-- These are format checks, not full SQL semantics or date/time validity.\n"
        "SELECT PROBE, SQLITE_EXPECTED, MARIADB_ACTUAL,\n"
        "CASE WHEN SQLITE_EXPECTED=MARIADB_ACTUAL THEN 'PASS' ELSE 'FAIL' END AS RESULT\n"
        "FROM (\n" + all_rows + "\n) AS comparisons\n"
        "ORDER BY RESULT, PROBE;\n"
    )


def safe_write(path, data):
    target=Path(path).expanduser()
    if target.exists() or target.is_symlink() or not target.parent.is_dir():
        raise ValueError("new_output_file_in_existing_folder_required")
    parent=target.parent.resolve()
    if any((p/".git").exists() for p in (parent,*parent.parents)):
        raise ValueError("output_must_be_outside_git")
    if "public_html" in parent.parts:
        raise ValueError("output_must_be_outside_public_webroot")
    with target.open("x",encoding="utf-8") as f:
        f.write(data)


def main():
    parser=argparse.ArgumentParser(description="RD CONNECT offline GLOB/REGEXP probes")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_constraints_csv")
    parser.add_argument("--generate-sql",required=True)
    args=parser.parse_args()
    try:
        sqlite_tables,unused=check.base.read_source(args.backup_file,args.sqlite_schema_json)
        target=check.base.read_target(args.mariadb_constraints_csv)
        rules=collect_rules(sqlite_tables,target)
        safe_write(args.generate_sql,generate_sql(rules))
    except (ValueError,OSError,UnicodeError,TypeError,KeyError,
            sqlite3.Error,csv.Error):
        print("REGEXP PROBE BUILDER BLOCKED: review CHECK schema before testing.",
              file=sys.stderr)
        return 1
    print("RD CONNECT MARIADB FORMAT PROBES: SYNTHETIC/READ ONLY")
    print("RULES:",len(rules))
    print("CASES:",sum(len(r["samples"]) for r in rules))
    for r in rules:
        print(" - "+r["table"]+"."+r["column"],
              "ANCHOR_START="+str(r["starts_anchored"]),
              "ANCHOR_END="+str(r["ends_anchored"]))
    print("SYNTHETIC_SELECT_SQL_WRITTEN: YES (outside git)")
    print("Run SQL only in MariaDB staging and inspect any FAIL rows.")
    print("FORMAT_TESTS_NOT_SEMANTIC_PROOF; IMPORT_AUTHORIZED: NO")
    print("NO STUDENT DATA; NO NETWORK; NO SQLITE/MARIADB WRITES.")
    return 0


if __name__=="__main__":
    sys.exit(main())
