#!/usr/bin/env python3
"""RD CONNECT: local-only read-only value-fit audit for SQLite -> MariaDB.

Reads a verified school backup (NOT the live SQLite DB), a safe SQLite schema
metadata report, and a phpMyAdmin information_schema.COLUMNS CSV export.
Prints aggregate counts and column identifiers only. NEVER writes DBs, exports
student values, sends traffic, or authorizes an import.
"""
import argparse
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path

BACKUP_NAME = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T[^/\\]*\.sqlite$", re.I)
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
EXPECTED_REPORT = "rd-connect-sqlite-backup-inventory-v1"
CSV_FIELDS = {
    "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "COLUMN_TYPE",
    "IS_NULLABLE", "EXTRA", "CHARACTER_MAXIMUM_LENGTH",
    "NUMERIC_PRECISION", "NUMERIC_SCALE", "DATETIME_PRECISION",
}
TEXT_TYPES = {"char", "varchar", "tinytext", "text", "mediumtext", "longtext"}
BLOB_TYPES = {"binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob"}
TEXT_BYTES = {"tinytext": 255, "text": 65535, "mediumtext": 16777215,
              "longtext": 4294967295}
BLOB_BYTES = {"tinyblob": 255, "blob": 65535, "mediumblob": 16777215,
              "longblob": 4294967295}
INT_BITS = {"tinyint": 8, "smallint": 16, "mediumint": 24, "int": 32,
            "integer": 32, "bigint": 64}


def identifier(value):
    if not isinstance(value, str) or not IDENT.fullmatch(value):
        raise ValueError("invalid_identifier")
    return '"' + value + '"'


def int_or_none(value):
    if value is None or not str(value).strip() or str(value).strip().upper() == "NULL":
        return None
    num = int(str(value).strip())
    if num < 0:
        raise ValueError("invalid_numeric_metadata")
    return num


def read_reports(source_file, target_file):
    with Path(source_file).open(encoding="utf-8-sig") as stream:
        report = json.load(stream)
    if (report.get("format") != EXPECTED_REPORT or
            report.get("sqlite_integrity") != "ok" or
            report.get("sqlite_foreign_keys") != "ok" or
            report.get("table_count") != 63 or
            not isinstance(report.get("tables"), list) or
            len(report["tables"]) != 63):
        raise ValueError("sqlite_inventory_invalid")
    source = {}
    for table in report["tables"]:
        name = table.get("table")
        cols = table.get("columns")
        if not isinstance(name, str) or not IDENT.fullmatch(name) or name in source:
            raise ValueError("sqlite_inventory_invalid")
        if not isinstance(cols, list) or not cols:
            raise ValueError("sqlite_inventory_invalid")
        keys = [col.get("name") for col in cols]
        if any(not isinstance(x, str) or not IDENT.fullmatch(x) for x in keys):
            raise ValueError("sqlite_inventory_invalid")
        if len(keys) != len(set(keys)):
            raise ValueError("sqlite_inventory_invalid")
        expected_rows = table.get("rows")
        if type(expected_rows) is not int or expected_rows < 0:
            raise ValueError("sqlite_inventory_invalid")
        source[name] = {"columns": set(keys), "rows": expected_rows}
    target = {}
    with Path(target_file).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("mariadb_csv_missing_header")
        reader.fieldnames = [f.strip().strip("\ufeff") for f in reader.fieldnames]
        if not CSV_FIELDS.issubset(reader.fieldnames):
            raise ValueError("mariadb_csv_missing_columns")
        for row in reader:
            if None in row:
                raise ValueError("mariadb_csv_invalid")
            name = (row["TABLE_NAME"] or "").strip()
            col = (row["COLUMN_NAME"] or "").strip()
            typ = (row["DATA_TYPE"] or "").strip().lower()
            if not IDENT.fullmatch(name) or not IDENT.fullmatch(col) or not typ:
                raise ValueError("mariadb_csv_invalid")
            nullable = (row["IS_NULLABLE"] or "").strip().upper()
            if nullable not in ("YES", "NO"):
                raise ValueError("mariadb_csv_invalid")
            fields = target.setdefault(name, {})
            if col in fields:
                raise ValueError("mariadb_csv_duplicate_column")
            fields[col] = {
                "type": typ,
                "column_type": (row["COLUMN_TYPE"] or "").lower(),
                "nullable": nullable,
                "extra": (row["EXTRA"] or "").lower(),
                "maxlen": int_or_none(row["CHARACTER_MAXIMUM_LENGTH"]),
                "numprec": int_or_none(row["NUMERIC_PRECISION"]),
                "numscale": int_or_none(row["NUMERIC_SCALE"]),
                "dtprec": int_or_none(row["DATETIME_PRECISION"]),
            }
    if len(target) != 63:
        raise ValueError("mariadb_csv_invalid_table_count")
    return source, target


def analyze_value(value, dest):
    """Return an issue classification, never the value."""
    if value is None:
        return "NOT_NULL" if dest["nullable"] == "NO" else None
    typ = dest["type"]
    if typ in TEXT_TYPES:
        if not isinstance(value, str):
            return "TEXT_TYPE"
        limit = dest["maxlen"]
        if limit is not None and len(value) > limit:
            return "TEXT_CHARACTER_LENGTH"
        byte_limit = TEXT_BYTES.get(typ)
        if byte_limit and len(value.encode("utf-8")) > byte_limit:
            return "TEXT_BYTE_LENGTH"
    elif typ in BLOB_TYPES:
        if not isinstance(value, bytes):
            return "BINARY_TYPE"
        limit = dest["maxlen"]
        if limit is None:
            limit = BLOB_BYTES.get(typ)
        if limit is not None and len(value) > limit:
            return "BINARY_LENGTH"
    elif typ in INT_BITS:
        if type(value) is not int:
            return "INTEGER_TYPE"
        bits = INT_BITS[typ]
        unsigned = "unsigned" in dest["column_type"]
        lower = 0 if unsigned else -(1 << (bits - 1))
        upper = (1 << bits) - 1 if unsigned else (1 << (bits - 1)) - 1
        if not lower <= value <= upper:
            return "INTEGER_RANGE"
    # DATE, DATETIME and other formats require their dedicated validation.
    return None


def audit(backup_file, report_file, csv_file):
    path = Path(backup_file).expanduser()
    if (path.is_symlink() or not BACKUP_NAME.fullmatch(path.name) or
            not path.is_file() or path.stat().st_size < 4096):
        raise ValueError("verified_backup_file_required")
    source, target = read_reports(report_file, csv_file)
    if set(source) - {"school_schema_migrations"} != set(target) - {"d1_migrations"}:
        raise ValueError("table_names_do_not_match")
    counts = {"fields": 0, "values": 0, "tables": 0, "rows": 0,
              "generated_skipped": 0, "not_null": 0, "length": 0, "range": 0,
              "type": 0, "unsupported_columns": 0}
    issues = {}
    with sqlite3.connect(
        path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True
    ) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        for name in sorted(set(source) - {"school_schema_migrations"}):
            cols = target[name]
            selected = [
                col for col in sorted(source[name]["columns"])
                if col in cols and "generated" not in cols[col]["extra"]
            ]
            if len(selected) != len(source[name]["columns"]):
                raise ValueError("source_columns_missing_or_generated")
            counts["generated_skipped"] += sum(
                "generated" in d["extra"] for d in cols.values())
            counts["fields"] += len(selected)
            counts["tables"] += 1
            cursor = db.execute(
                "SELECT " + ", ".join(identifier(col) for col in selected) +
                " FROM " + identifier(name)
            )
            actual = 0
            for row in cursor:
                actual += 1
                counts["values"] += len(selected)
                for col, value in zip(selected, row):
                    d = cols[col]
                    typ = d["type"]
                    if typ not in TEXT_TYPES | BLOB_TYPES | set(INT_BITS):
                        counts["unsupported_columns"] += 1
                        continue
                    issue = analyze_value(value, d)
                    if issue:
                        if issue == "NOT_NULL":
                            counts["not_null"] += 1
                        elif "LENGTH" in issue:
                            counts["length"] += 1
                        elif "RANGE" in issue:
                            counts["range"] += 1
                        else:
                            counts["type"] += 1
                        key = name + "." + col + " [" + issue + "]"
                        issues[key] = issues.get(key, 0) + 1
            if actual != source[name]["rows"]:
                raise ValueError("backup_and_inventory_row_count_disagree")
            counts["rows"] += actual
    return counts, issues


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT SQLite->MariaDB read-only value-fit audit")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_extended_csv")
    args = parser.parse_args()
    try:
        stats, issues = audit(
            args.backup_file, args.sqlite_schema_json, args.mariadb_columns_extended_csv
        )
    except (ValueError, OSError, sqlite3.Error, csv.Error,
            json.JSONDecodeError, UnicodeError, OverflowError):
        print("DATA FIT AUDIT BLOCKED: metadata/backup incomplete or invalid.",
              file=sys.stderr)
        return 1
    print("RD CONNECT SQLITE->MARIADB DATA FIT AUDIT: READ ONLY")
    for name, n in stats.items():
        print(name.upper() + ":", n)
    print("ISSUE_FIELDS:", len(issues))
    for label, total in sorted(issues.items()):
        print(" - " + label + ": " + str(total))
    print("NOT VERIFIED: SQLite->MariaDB unique/index/collation conflicts,")
    print("CHECK/FK/trigger rules, DATETIME timezone interpretation, defaults,")
    print("non-integer numeric conversion, and real INSERT transactions.")
    print("NO STUDENT VALUES PRINTED; NO NETWORK; NO SQLITE/MARIADB WRITES.")
    return 2 if issues else 0


if __name__ == "__main__":
    sys.exit(main())
