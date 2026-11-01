#!/usr/bin/env python3
"""RD CONNECT offline-only MariaDB generated/CHECK/trigger gate.
Reads a VERIFIED static SQLite backup and a metadata-only MariaDB CSV.
Does not export student rows, connect to the network, or change databases.
"""
import argparse
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path

BACKUP_RE = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T[^/\\]*\.sqlite$", re.I)
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
EXPECTED = {
    ("students", "live_classroom_id"): ("deleted_at", "classroom_id"),
    ("students", "live_roll_no"): ("deleted_at", "roll_no"),
    ("student_enrollments", "current_student_id"): ("end_date", "student_id"),
    ("student_enrollments", "current_classroom_id"): ("end_date", "classroom_id"),
    ("student_enrollments", "current_roll_no"): ("end_date", "roll_no"),
}
FIELDS = {"ITEM_TYPE", "TABLE_NAME", "ITEM_NAME", "ITEM_VALUE"}


def generated_matches(table, column, expression):
    if (table, column) not in EXPECTED:
        return False
    when, selected = EXPECTED[(table, column)]
    normalized = re.sub(r"\s+", "", expression.lower().replace(chr(96), ""))
    return normalized == "casewhen" + when + "isnullthen" + selected + "elsenullend"


def read_target(path):
    result = {"GENERATED": {}, "CHECK": [], "TRIGGER": []}
    with Path(path).open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("metadata_header_missing")
        reader.fieldnames = [x.strip().strip("\ufeff") for x in reader.fieldnames]
        if not FIELDS.issubset(reader.fieldnames):
            raise ValueError("metadata_header_incomplete")
        for row in reader:
            if None in row:
                raise ValueError("metadata_csv_invalid")
            kind = (row["ITEM_TYPE"] or "").strip().upper()
            table = (row["TABLE_NAME"] or "").strip()
            name = (row["ITEM_NAME"] or "").strip()
            expression = (row["ITEM_VALUE"] or "").strip()
            if (kind not in result or not IDENT.fullmatch(table)
                    or not IDENT.fullmatch(name)):
                raise ValueError("metadata_identifier_invalid")
            if kind == "GENERATED":
                if (table, name) in result[kind]:
                    raise ValueError("duplicate_generated_column")
                result[kind][table, name] = expression
            else:
                result[kind].append((table, name, expression))
    return result


def read_source(backup, inventory):
    file = Path(backup).expanduser()
    if (file.is_symlink() or not BACKUP_RE.fullmatch(file.name)
            or not file.is_file() or file.stat().st_size < 4096):
        raise ValueError("verified_backup_required")
    with Path(inventory).open(encoding="utf-8-sig") as stream:
        obj = json.load(stream)
    if (obj.get("format") != "rd-connect-sqlite-backup-inventory-v1"
            or obj.get("sqlite_integrity") != "ok"
            or obj.get("sqlite_foreign_keys") != "ok"
            or obj.get("table_count") != 63
            or len(obj.get("tables", [])) != 63):
        raise ValueError("invalid_sqlite_inventory")
    expected = {t["table"] for t in obj["tables"]}
    with sqlite3.connect(file.resolve().as_uri()+"?mode=ro&immutable=1", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        tables = db.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        triggers = db.execute(
            "SELECT tbl_name,name FROM sqlite_master WHERE type='trigger' "
            "ORDER BY tbl_name,name"
        ).fetchall()
    if {name for name, _ in tables} != expected:
        raise ValueError("backup_tables_differ_from_inventory")
    return tables, triggers


def evaluate(tables, triggers, target):
    generated = target["GENERATED"]
    missing = sorted(set(EXPECTED) - set(generated))
    unexpected = sorted(set(generated) - set(EXPECTED))
    malformed = sorted(k for k, expression in generated.items()
                       if k in EXPECTED and not generated_matches(*k, expression))
    sqlite_checks = sum(
        len(re.findall(r"\bCHECK\s*\(", ddl or "", re.I))
        for _, ddl in tables
    )
    return {
        "generated_expected": 5,
        "generated_matched": 5-len(missing)-len(malformed),
        "generated_missing": missing,
        "generated_unexpected": unexpected,
        "generated_unrecognized_expression": malformed,
        "sqlite_check_syntax_count": sqlite_checks,
        "mariadb_check_count": len(target["CHECK"]),
        "sqlite_trigger_count": len(triggers),
        "mariadb_trigger_count": len(target["TRIGGER"]),
        "sqlite_triggers": [".".join(t) for t in triggers],
        "mariadb_triggers": [".".join((t, n)) for t, n, _ in target["TRIGGER"]],
    }


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT offline constraints audit")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_constraints_csv")
    args = parser.parse_args()
    try:
        tables, triggers = read_source(args.backup_file, args.sqlite_schema_json)
        result = evaluate(tables, triggers, read_target(args.mariadb_constraints_csv))
    except (OSError, ValueError, KeyError, TypeError, IndexError,
            UnicodeError, sqlite3.Error, csv.Error, json.JSONDecodeError):
        print("CONSTRAINT AUDIT BLOCKED: input metadata/backup invalid",
              file=sys.stderr)
        return 1
    print("RD CONNECT MARIADB CONSTRAINT PREFLIGHT: READ ONLY")
    for key in (
        "generated_expected", "generated_matched", "sqlite_check_syntax_count",
        "mariadb_check_count", "sqlite_trigger_count", "mariadb_trigger_count"
    ):
        print(key.upper()+":", result[key])
    for key in ("generated_missing", "generated_unexpected",
                "generated_unrecognized_expression"):
        print(key.upper()+":", len(result[key]))
        for table, column in result[key]:
            print(" - "+table+"."+column)
    for label in ("sqlite_triggers", "mariadb_triggers"):
        print(label.upper()+":", len(result[label]))
        for item in result[label]:
            print(" -",item)
    print("CAUTION: CHECK syntax counts are NOT semantic proof.")
    print("Any SQLite trigger without a MariaDB equivalent needs manual review.")
    print("NO PERSONAL DATA EXPORTED; NO NETWORK; NO DB WRITES; IMPORT_AUTHORIZED: NO")
    return 2 if (
        result["generated_matched"] != 5 or result["generated_unexpected"]
        or result["sqlite_trigger_count"] != result["mariadb_trigger_count"]
    ) else 0


if __name__ == "__main__":
    sys.exit(main())
