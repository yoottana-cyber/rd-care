#!/usr/bin/env python3
"""Read-only SQLite date/time audit before testing RD CONNECT MariaDB imports.
Requires a verified copy of rd-connect-YYYY-...sqlite, SQLite inventory JSON,
and phpMyAdmin information_schema.COLUMNS CSV. Logs aggregate counts only.
No database writes, network access, account records or timestamp values output.
"""
import argparse
import csv
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKUP_NAME = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T[^/\\]*\.sqlite$", re.I)
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
DATE_PATTERN = re.compile(
    r"^(\d{4})-(\d\d)-(\d\d)([ T])(\d\d):(\d\d):(\d\d)"
    r"(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)?$"
)
EXPECTED_FORMAT = "rd-connect-sqlite-backup-inventory-v1"
COUNTERS = (
    "total", "null", "null_violation", "blank", "invalid", "naive_space",
    "naive_iso_t", "utc_z", "offset", "fractional", "out_of_range",
)


def quote(identifier):
    if not IDENT.fullmatch(identifier):
        raise ValueError("invalid_column_identifier")
    return '"' + identifier + '"'


def read_manifest(path):
    with Path(path).open(encoding="utf-8-sig") as stream:
        data = json.load(stream)
    if (data.get("format") != EXPECTED_FORMAT or data.get("table_count") != 63
        or data.get("sqlite_integrity") != "ok"
        or data.get("sqlite_foreign_keys") != "ok"):
        raise ValueError("invalid_source_metadata")
    tables = data.get("tables")
    if not isinstance(tables, list) or len(tables) != 63:
        raise ValueError("invalid_source_metadata")
    result = {}
    for entry in tables:
        name = entry.get("table")
        if not isinstance(name, str) or not IDENT.fullmatch(name) or name in result:
            raise ValueError("invalid_source_metadata")
        cols = entry.get("columns")
        if not isinstance(cols, list):
            raise ValueError("invalid_source_metadata")
        column_map = {}
        for column in cols:
            col = column.get("name")
            if not isinstance(col, str) or not IDENT.fullmatch(col) or col in column_map:
                raise ValueError("invalid_source_metadata")
            column_map[col] = str(column.get("type") or "").upper()
        result[name] = column_map
    return result


def read_target(path):
    target = {}
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("invalid_mariadb_column_csv")
        reader.fieldnames = [x.strip().strip("\ufeff") for x in reader.fieldnames]
        needed = {"TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "IS_NULLABLE", "EXTRA"}
        if not needed.issubset(reader.fieldnames):
            raise ValueError("invalid_mariadb_column_csv")
        for row in reader:
            if row.get(None) is not None:
                raise ValueError("invalid_mariadb_column_csv")
            name = (row.get("TABLE_NAME") or "").strip()
            col = (row.get("COLUMN_NAME") or "").strip()
            typ = (row.get("DATA_TYPE") or "").strip().lower()
            nullable = (row.get("IS_NULLABLE") or "").strip().upper()
            if (not IDENT.fullmatch(name) or not IDENT.fullmatch(col)
                or not typ or nullable not in ("YES", "NO")):
                raise ValueError("invalid_mariadb_column_csv")
            if col in target.setdefault(name, {}):
                raise ValueError("invalid_mariadb_column_csv")
            target[name][col] = {
                "type": typ,
                "nullable": nullable,
                "extra": (row.get("EXTRA") or "").strip().lower(),
            }
    if len(target) != 63:
        raise ValueError("invalid_mariadb_column_csv")
    return target


def assess_time(value, required):
    if value is None:
        return ("null_violation" if required else "null"), False
    if not isinstance(value, str):
        return "invalid", False
    if not value.strip():
        return "blank", False
    match = DATE_PATTERN.fullmatch(value)
    if match is None:
        return "invalid", False
    if int(match.group(1)) < 1000:
        return "out_of_range", False
    try:
        parsed = datetime.fromisoformat(value.replace(" ", "T", 1))
    except ValueError:
        return "invalid", False
    if parsed.year < 1000:
        return "out_of_range", False
    zone = match.group(9)
    if zone:
        try:
            utc = parsed.astimezone(timezone.utc)
            if utc.year < 1000 or utc.year > 9999:
                return "out_of_range", False
        except (OverflowError, ValueError):
            return "out_of_range", False
        kind = "utc_z" if zone == "Z" else "offset"
    else:
        kind = "naive_space" if match.group(4) == " " else "naive_iso_t"
    return kind, bool(match.group(8))


def scan(backup_file, manifest_path, target_csv):
    path = Path(backup_file).expanduser()
    if (path.is_symlink() or not BACKUP_NAME.fullmatch(path.name)
        or not path.is_file() or path.stat().st_size < 4096):
        raise ValueError("verified_backup_file_required")
    source = read_manifest(manifest_path)
    target = read_target(target_csv)
    fields = []
    for table, columns in target.items():
        for col, meta in columns.items():
            if (meta["type"] == "datetime" and table in source
                and col in source[table]
                and any(x in source[table][col] for x in ("CHAR", "TEXT", "CLOB"))):
                if "generated" in meta["extra"]:
                    raise ValueError("unexpected_generated_datetime")
                fields.append((table, col, meta["nullable"] == "NO"))
    if not fields:
        raise ValueError("no_datetime_columns")
    totals = {name: 0 for name in COUNTERS}
    review = []
    with sqlite3.connect(
        path.resolve().as_uri() + "?mode=ro&immutable=1", uri=True, timeout=5
    ) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        for table, column, required in sorted(fields):
            counts = {name: 0 for name in COUNTERS}
            query = "SELECT " + quote(column) + " FROM " + quote(table)
            for (value,) in db.execute(query):
                counts["total"] += 1
                kind, fractional = assess_time(value, required)
                counts[kind] += 1
                if fractional:
                    counts["fractional"] += 1
            for name in COUNTERS:
                totals[name] += counts[name]
            significant = (
                "invalid", "null_violation", "blank", "out_of_range",
                "utc_z", "offset", "fractional", "naive_iso_t",
            )
            if any(counts[k] for k in significant):
                review.append((table, column, counts))
    return len(fields), totals, review


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT offline datetime audit")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_csv")
    args = parser.parse_args()
    try:
        field_count, totals, review = scan(
            args.backup_file, args.sqlite_schema_json, args.mariadb_columns_csv
        )
    except (ValueError, OSError, UnicodeError, sqlite3.Error,
            csv.Error, json.JSONDecodeError):
        print(
            "DATETIME AUDIT BLOCKED: input invalid or backup verification failed.",
            file=sys.stderr,
        )
        return 1
    print("RD CONNECT SQLITE DATETIME AUDIT: READ ONLY")
    print("DATE_COLUMNS_SCANNED:", field_count)
    for name in COUNTERS:
        print(name.upper() + ":", totals[name])
    print("REVIEW_FIELDS:", len(review))
    relevant = (
        "invalid", "null_violation", "blank", "out_of_range",
        "utc_z", "offset", "fractional", "naive_iso_t",
    )
    for table, column, counts in review:
        parts = [key + "=" + str(counts[key]) for key in relevant if counts[key]]
        print(" - " + table + "." + column + ": " + ", ".join(parts))
    print("NAIVE datetime fields have no timezone marker; timezone not inferred.")
    print("DATETIME precision, timezone rules and live-write cutover: NOT VERIFIED.")
    print("SOURCE BACKUP UNCHANGED. NO NETWORK REQUESTS. NO MARIADB WRITES.")
    return 2 if any(
        totals[k] for k in ("invalid", "null_violation", "blank", "out_of_range")
    ) else 0


if __name__ == "__main__":
    sys.exit(main())
