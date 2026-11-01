#!/usr/bin/env python3
"""Offline, read-only RD CONNECT SQLite -> MariaDB pre-import compatibility scan.

Inputs contain structural metadata and counts only; never connects to either DB.
Does NOT authorize importing or changing the production RD CONNECT application.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

FORMAT = "rd-connect-sqlite-backup-inventory-v1"
GENERATED = {
    "students": {"live_classroom_id", "live_roll_no"},
    "student_enrollments": {
        "current_student_id", "current_classroom_id", "current_roll_no"
    },
}
OLD_LEDGER = "school_schema_migrations"
NEW_LEDGER = "d1_migrations"
NEED = {"TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE", "EXTRA"}
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
TARGET_INTEGER = {"integer", "int", "bigint", "smallint", "tinyint", "mediumint", "bit"}
TARGET_TEXT = {
    "char", "varchar", "tinytext", "text", "mediumtext", "longtext", "enum", "set"
}
TARGET_DATE = {"date", "datetime", "timestamp", "time", "year"}
TARGET_BINARY = {"binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob"}
TARGET_FLOAT = {"float", "double", "decimal", "numeric", "real"}


def sqlite_affinity(type_name):
    # https://www.sqlite.org/datatype3.html#determination_of_column_affinity
    value = (type_name or "").upper()
    if "INT" in value:
        return "integer"
    if any(mark in value for mark in ("CHAR", "CLOB", "TEXT")):
        return "text"
    if "BLOB" in value or not value:
        return "blob"
    if any(mark in value for mark in ("REAL", "FLOA", "DOUB")):
        return "real"
    return "numeric"


def inspect_sources(sqlite_path, csv_path):
    with Path(sqlite_path).open(encoding="utf-8-sig") as f:
        source = json.load(f)
    if (source.get("format") != FORMAT or source.get("sqlite_integrity") != "ok"
            or source.get("sqlite_foreign_keys") != "ok"
            or source.get("table_count") != 63):
        raise ValueError("sqlite_report_invalid")
    tables = source.get("tables")
    if not isinstance(tables, list) or len(tables) != 63:
        raise ValueError("sqlite_table_inventory_invalid")
    s = {}
    for table in tables:
        name, columns = table.get("table"), table.get("columns")
        if not isinstance(name, str) or not IDENT.fullmatch(name) or name in s:
            raise ValueError("sqlite_table_inventory_invalid")
        if not isinstance(columns, list) or not columns:
            raise ValueError("sqlite_table_inventory_invalid")
        d = {}
        for column in columns:
            key = column.get("name")
            if not isinstance(key, str) or not IDENT.fullmatch(key) or key in d:
                raise ValueError("sqlite_column_inventory_invalid")
            d[key] = column
        s[name] = d
    t = {}
    with Path(csv_path).open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("mariadb_csv_header_invalid")
        reader.fieldnames = [x.strip().strip("\ufeff") for x in reader.fieldnames]
        if not NEED.issubset(reader.fieldnames):
            raise ValueError("mariadb_csv_header_invalid")
        for row in reader:
            if row.get(None) is not None:
                raise ValueError("mariadb_csv_invalid")
            name = (row.get("TABLE_NAME") or "").strip()
            column = (row.get("COLUMN_NAME") or "").strip()
            kind = (row.get("DATA_TYPE") or "").strip().lower()
            if not IDENT.fullmatch(name) or not IDENT.fullmatch(column) or not kind:
                raise ValueError("mariadb_csv_invalid")
            if (row.get("IS_NULLABLE") or "").strip().upper() not in ("YES", "NO"):
                raise ValueError("mariadb_csv_invalid")
            t.setdefault(name, {})
            if column in t[name]:
                raise ValueError("mariadb_csv_duplicate_column")
            t[name][column] = {
                "type": kind,
                "extra": (row.get("EXTRA") or "").strip().lower(),
                "nullable": (row.get("IS_NULLABLE") or "").strip().upper(),
            }
    if len(t) != 63:
        raise ValueError("mariadb_table_inventory_invalid")
    return s, t


def audit(s, t):
    unexpected = []
    if OLD_LEDGER not in s or NEW_LEDGER not in t:
        unexpected.append("migration_ledger_table_missing")
    if NEW_LEDGER in s or OLD_LEDGER in t:
        unexpected.append("migration_ledger_table_collides")
    ss = set(s) - {OLD_LEDGER}
    ts = set(t) - {NEW_LEDGER}
    for name in sorted(ss - ts):
        unexpected.append("missing_table:" + name)
    for name in sorted(ts - ss):
        unexpected.append("extra_table:" + name)
    generated_found = 0
    direct_columns = 0
    dates_to_review = []
    conversions_to_review = []
    for table in sorted(ss & ts):
        source = s[table]
        dest = t[table]
        expected_generated = GENERATED.get(table, set())
        for column in sorted(set(dest) - set(source)):
            if column not in expected_generated:
                unexpected.append("unexpected_extra_column:" + table + "." + column)
            elif "generated" not in dest[column]["extra"]:
                unexpected.append("not_generated:" + table + "." + column)
            else:
                generated_found += 1
        for column in sorted(set(source) - set(dest)):
            unexpected.append("missing_column:" + table + "." + column)
        for column in sorted(set(source) & set(dest)):
            target = dest[column]
            if "generated" in target["extra"]:
                unexpected.append("source_column_generated_in_target:" + table + "." + column)
                continue
            direct_columns += 1
            src = sqlite_affinity(source[column].get("type"))
            kind = target["type"]
            if src == "text":
                if kind in TARGET_DATE:
                    dates_to_review.append(table + "." + column + ":TEXT->" + kind)
                elif kind not in TARGET_TEXT:
                    conversions_to_review.append(table + "." + column + ":TEXT->" + kind)
            elif src == "integer":
                if kind not in TARGET_INTEGER:
                    conversions_to_review.append(table + "." + column + ":INTEGER->" + kind)
            elif src == "blob":
                if kind not in TARGET_BINARY:
                    conversions_to_review.append(table + "." + column + ":BLOB->" + kind)
            elif src == "real":
                if kind not in TARGET_FLOAT:
                    conversions_to_review.append(table + "." + column + ":REAL->" + kind)
            elif src == "numeric":
                if kind not in TARGET_FLOAT | TARGET_INTEGER:
                    conversions_to_review.append(table + "." + column + ":NUMERIC->" + kind)
    for table, columns in GENERATED.items():
        for column in columns:
            if column not in t.get(table, {}):
                unexpected.append("expected_generated_column_missing:" + table + "." + column)
    return {
        "sqlite_tables": len(s),
        "mariadb_tables": len(t),
        "generated_columns_verified": generated_found,
        "direct_columns_checked": direct_columns,
        "structural_blockers": unexpected,
        "date_text_conversions": dates_to_review,
        "type_family_mismatches": conversions_to_review,
        "ready_for_automated_import": False,
    }


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT offline pre-import schema audit")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_csv")
    args = parser.parse_args()
    try:
        report = audit(*inspect_sources(args.sqlite_schema_json, args.mariadb_columns_csv))
    except (ValueError, OSError, csv.Error, json.JSONDecodeError) as exc:
        known = {
            "sqlite_report_invalid", "sqlite_table_inventory_invalid",
            "sqlite_column_inventory_invalid", "mariadb_csv_header_invalid",
            "mariadb_csv_invalid", "mariadb_csv_duplicate_column",
            "mariadb_table_inventory_invalid",
        }
        err = str(exc)
        print("PREFLIGHT BLOCKED:", err if err in known else "metadata_not_readable",
              file=sys.stderr)
        return 1
    print("RD CONNECT SQLITE -> MARIADB PRE-IMPORT AUDIT (READ ONLY)")
    print("SQLITE TABLES:", report["sqlite_tables"],
          "| MARIADB TABLES:", report["mariadb_tables"])
    print("GENERATED COLUMNS:", report["generated_columns_verified"], "/ 5")
    print("SHARED DIRECT COLUMNS:", report["direct_columns_checked"])
    for key in ("structural_blockers", "type_family_mismatches", "date_text_conversions"):
        items = report[key]
        print(key.upper() + ":", len(items))
        for issue in items[:80]:
            print("  -", issue)
        if len(items) > 80:
            print("  ... more issues omitted")
    print("Migration ledgers are NOT imported as ordinary student data.")
    print("NOT YET VERIFIED: default values, max lengths, charset, indexes, FKs, triggers,")
    print("generated expressions, source value conversion, nullability and destination counts.")
    print("NO MARIA DB WRITES; PRODUCTION SQLITE UNCHANGED; IMPORT NOT ENABLED.")
    return 2 if report["structural_blockers"] or report["type_family_mismatches"] else 0


if __name__ == "__main__":
    sys.exit(main())
