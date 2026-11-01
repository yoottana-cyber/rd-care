#!/usr/bin/env python3
"""RD CONNECT MariaDB staging emptiness gate (SQL SELECT generator + CSV verifier).

Creates SELECT COUNT(*) UNION ALL for all 63 expected MariaDB tables.
Does not connect to a database; verifies phpMyAdmin CSV against the same
source-only inventory and requires ALL destination tables to be empty.
No school records are read or returned.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
DEFAULT_SCHEMA = "ratsadaa_connect"
BACKUP_FORMAT = "rd-connect-sqlite-backup-inventory-v1"


def expected_tables(source_json):
    with Path(source_json).open(encoding="utf-8-sig") as stream:
        report = json.load(stream)
    if (report.get("format") != BACKUP_FORMAT or
            report.get("sqlite_integrity") != "ok" or
            report.get("sqlite_foreign_keys") != "ok" or
            report.get("table_count") != 63):
        raise ValueError("invalid_inventory")
    items = report.get("tables")
    if not isinstance(items, list) or len(items) != 63:
        raise ValueError("invalid_inventory")
    names = [entry.get("table") for entry in items]
    if (len(set(names)) != 63 or
            any(not isinstance(name, str) or not IDENT.fullmatch(name)
                for name in names) or
            "school_schema_migrations" not in names or "d1_migrations" in names):
        raise ValueError("invalid_inventory")
    return sorted(
        "d1_migrations" if n == "school_schema_migrations" else n
        for n in names
    )


def generate_sql(tables, schema):
    if schema != DEFAULT_SCHEMA:
        # Known MariaDB schema is staging only. Live app uses local SQLite.
        raise ValueError("unapproved_staging_schema")
    if len(tables) != 63:
        raise ValueError("expected_63_tables")
    tick = chr(96)
    statements = [
        "SELECT '" + table + "' AS TABLE_NAME, COUNT(*) AS ROW_COUNT "
        "FROM " + tick + schema + tick + "." + tick + table + tick
        for table in tables
    ]
    return "-- READ ONLY: 63 exact row-count queries in MariaDB staging.\n" + (
        "\nUNION ALL\n".join(statements)
    ) + "\nORDER BY TABLE_NAME;\n"


def verify_csv(tables, csv_path):
    file = Path(csv_path).expanduser()
    if not file.is_file():
        raise ValueError("count_csv_missing")
    if file.stat().st_size == 0:
        raise ValueError("count_csv_empty")
    actual = {}
    with file.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("invalid_count_csv_header")
        reader.fieldnames = [h.strip().strip("\ufeff") for h in reader.fieldnames]
        if not {"TABLE_NAME", "ROW_COUNT"}.issubset(reader.fieldnames):
            if any(";" in field for field in reader.fieldnames):
                raise ValueError("count_csv_delimiter_should_be_comma")
            raise ValueError("invalid_count_csv_header")
        for row in reader:
            if None in row:
                raise ValueError("invalid_count_csv")
            table = (row["TABLE_NAME"] or "").strip()
            count = (row["ROW_COUNT"] or "").strip()
            if (not IDENT.fullmatch(table) or table in actual or
                    not count.isdecimal()):
                raise ValueError("invalid_count_csv")
            actual[table] = int(count)
    if set(actual) != set(tables):
        raise ValueError("mariadb_count_tables_missing_or_extra")
    return {
        "tables": len(actual),
        "empty_tables": sum(n == 0 for n in actual.values()),
        "non_empty": [(name, n) for name, n in sorted(actual.items()) if n],
        "total_rows": sum(actual.values()),
    }


def safe_write_sql(filename, sql):
    target = Path(filename).expanduser()
    if target.exists() or not target.parent.is_dir() or target.is_symlink():
        raise ValueError("output_must_be_new_file")
    parent = target.parent.resolve()
    if any((folder / ".git").exists() for folder in (parent, *parent.parents)):
        raise ValueError("output_must_be_outside_git")
    if "public_html" in parent.parts:
        raise ValueError("output_must_be_outside_webroot")
    with target.open("x", encoding="utf-8") as stream:
        stream.write(sql)


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT MariaDB staging read-only exact COUNT gate")
    parser.add_argument("sqlite_schema_json")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--generate-sql")
    group.add_argument("--verify-csv")
    args = parser.parse_args()
    try:
        tables = expected_tables(args.sqlite_schema_json)
        if args.generate_sql:
            safe_write_sql(args.generate_sql, generate_sql(tables, DEFAULT_SCHEMA))
            print("RD CONNECT STAGING SQL SELECT COUNT GENERATOR: READ ONLY")
            print("SELECTS:", len(tables))
            print("SCHEMA:", DEFAULT_SCHEMA)
            print("SQL_FILE_WRITTEN: YES (outside Git repository)")
            print("NO DATABASE CONNECTION OR WRITES.")
            return 0
        result = verify_csv(tables, args.verify_csv)
    except (ValueError, OSError, UnicodeError, TypeError, KeyError,
            json.JSONDecodeError, csv.Error) as exc:
        known = {
            "count_csv_missing", "count_csv_empty",
            "count_csv_encoding_not_utf8", "count_csv_delimiter_should_be_comma",
            "invalid_inventory", "unapproved_staging_schema",
            "expected_63_tables", "invalid_count_csv_header",
            "invalid_count_csv", "mariadb_count_tables_missing_or_extra",
            "output_must_be_new_file", "output_must_be_outside_git",
            "output_must_be_outside_webroot",
        }
        reason = "count_csv_encoding_not_utf8" if isinstance(exc, UnicodeError) else str(exc)
        print("STAGING EMPTY GATE BLOCKED: " +
              (reason if reason in known else "metadata_unreadable"),
              file=sys.stderr)
        return 1
    print("RD CONNECT MARIADB STAGING EXACT COUNT GATE: READ ONLY")
    print("TABLES:",result["tables"])
    print("EMPTY_TABLES:",result["empty_tables"])
    print("NON_EMPTY_TABLES:",len(result["non_empty"]))
    print("TOTAL_TARGET_ROWS:",result["total_rows"])
    for name, n in result["non_empty"]:
        print(" - "+name+": "+str(n))
    print("NO DATABASE CONNECTIONS OR WRITES. NOT AN IMPORT COMMAND.")
    return 2 if result["non_empty"] else 0


if __name__ == "__main__":
    sys.exit(main())
