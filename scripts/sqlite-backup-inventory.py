#!/usr/bin/env python3
"""RD CONNECT: inspect a COPIED, VERIFIED school SQLite backup (read only).

No DB modifications, external connections, row exports, names, usernames,
passwords, tokens, or student-level records. Output: schema + row counts only.

Usage:
    py scripts/sqlite-backup-inventory.py "C:\private\rd-connect-....sqlite"
    py scripts/sqlite-backup-inventory.py "C:\private\rd-connect-....sqlite" --report "C:\private\sqlite-schema-summary.json"
"""
import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path


BACKUP_NAME = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T.*\.sqlite$", re.I)
INTERESTING = (
    "users", "students", "classrooms", "portal_accounts",
    "guardian_student_links", "attendance_daily", "attendance_period",
    "behavior_records", "school_schema_migrations",
)
VERSION = "rd-connect-sqlite-backup-inventory-v1"


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def inspect_backup(filename):
    """Return metadata/counts only; never include data values in the report."""
    supplied_path = Path(filename).expanduser()
    if supplied_path.is_symlink():
        raise ValueError("verified_backup_file_missing_or_invalid")
    db_path = supplied_path.resolve()
    if not BACKUP_NAME.fullmatch(db_path.name):
        raise ValueError("verified_backup_filename_required")
    if not db_path.is_file() or db_path.is_symlink() or db_path.stat().st_size < 4096:
        raise ValueError("verified_backup_file_missing_or_invalid")
    # immutable=1 prevents SQLite from creating -wal/-shm next to the downloaded
    # static backup. This MUST be a completed school:backup snapshot, NOT the
    # live rd-connect.sqlite used by Passenger.
    connection = sqlite3.connect(
        db_path.as_uri() + "?mode=ro&immutable=1", uri=True, timeout=5
    )
    try:
        connection.execute("PRAGMA query_only=ON")
        integrity = connection.execute("PRAGMA integrity_check").fetchall()
        if integrity != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if connection.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        table_names = [
            row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        entries = []
        total = 0
        for name in table_names:
            safe = quote(name)
            rows = int(connection.execute(
                "SELECT COUNT(*) FROM " + safe
            ).fetchone()[0])
            cols = [
                {
                    "name": col[1],
                    "type": col[2],
                    "pk": col[5],
                    "hidden": col[6],
                }
                for col in connection.execute("PRAGMA table_xinfo(" + safe + ")")
            ]
            foreign_keys = [
                {
                    "parent_table": fk[2],
                    "child_column": fk[3],
                    "parent_column": fk[4],
                }
                for fk in connection.execute("PRAGMA foreign_key_list(" + safe + ")")
            ]
            entries.append({
                "table": name,
                "rows": rows,
                "columns": cols,
                "foreign_keys": foreign_keys,
            })
            total += rows
        counts = {e["table"]: e["rows"] for e in entries}
        return {
            "format": VERSION,
            "sqlite_integrity": "ok",
            "sqlite_foreign_keys": "ok",
            "table_count": len(table_names),
            "total_rows_all_tables": total,
            "selected_counts": {
                name: counts[name] for name in INTERESTING if name in counts
            },
            "tables": entries,
        }
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(
        description="Read-only inspection of a verified RD CONNECT SQLite backup"
    )
    parser.add_argument("backup_file", help="Local copy of rd-connect-YYYY-...sqlite")
    parser.add_argument(
        "--report", type=Path,
        help="Save schema and table counts only as JSON (NO student rows)"
    )
    args = parser.parse_args()
    try:
        report = inspect_backup(args.backup_file)
        if args.report:
            target = args.report.expanduser().resolve()
            # Avoid accidentally committing even the metadata report to GitHub.
            if any((p / ".git").exists() for p in (target.parent, *target.parents)):
                raise ValueError("report_must_be_outside_git_repository")
            if target.exists():
                raise ValueError("report_already_exists")
            if not target.parent.is_dir():
                raise ValueError("report_parent_directory_missing")
            with target.open("x", encoding="utf-8") as out:
                json.dump(report, out, ensure_ascii=False, indent=2)
                out.write("\n")
        print("RD CONNECT SQLITE BACKUP INVENTORY: READ ONLY")
        print("INTEGRITY: OK | FOREIGN KEYS: OK")
        print("TABLES:", report["table_count"])
        print("TOTAL ROWS ACROSS ALL TABLES:", report["total_rows_all_tables"])
        for name, count in report["selected_counts"].items():
            print(name + ":", count)
        if args.report:
            print("SCHEMA/COUNTS REPORT SAVED (no personal records).")
        print("SOURCE BACKUP UNCHANGED. NO NETWORK REQUESTS. NO MARIA DB WRITES.")
        return 0
    except (ValueError, OSError, sqlite3.Error) as exc:
        # Never print full database paths, SQL data, or sensitive records.
        known = {
            "verified_backup_filename_required",
            "verified_backup_file_missing_or_invalid",
            "backup_integrity_failed", "backup_foreign_keys_failed",
            "report_must_be_outside_git_repository",
            "report_already_exists", "report_parent_directory_missing",
        }
        error = str(exc)
        print("PREFLIGHT BLOCKED: " +
              (error if error in known else "unable_to_read_backup"),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
