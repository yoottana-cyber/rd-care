#!/usr/bin/env python3
"""RD CONNECT batch 2: local-only export of a trusted Wrangler D1 SQL dump.

Never upload SQL dumps or JSONL student records to GitHub or to ChatGPT.
No network requests. Uses Python standard library sqlite3.
This exports data files locally ONLY after explicit --export-local switch.
Run in an access-controlled directory and securely protect the output.
"""
import argparse
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile

EXPECTED_TABLES = 63
ALLOW_NAME = __import__("re").compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")


def safe_value(value):
    if isinstance(value, bytes):
        return {"$binary_base64": base64.b64encode(value).decode("ascii")}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    raise ValueError("unsupported_sqlite_value")


def real_tables(connection):
    return sorted(row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ))


def export_dump(dump_file, output_dir):
    destination = Path(output_dir).expanduser().resolve()
    if destination.exists():
        raise ValueError("output_directory_already_exists")
    if not Path(dump_file).is_file():
        raise ValueError("trusted_d1_dump_not_found")
    # Never place dump data or secrets in a database used by Node/DirectAdmin.
    with tempfile.TemporaryDirectory(prefix="rd_d1_private_") as tmp:
        dbpath = Path(tmp) / "d1-export.sqlite"
        connection = sqlite3.connect(str(dbpath))
        try:
            connection.executescript(Path(dump_file).read_text(encoding="utf-8-sig"))
            tables = real_tables(connection)
            if len(tables) != EXPECTED_TABLES or any(
                not ALLOW_NAME.fullmatch(x) for x in tables
            ):
                raise ValueError("d1_table_inventory_mismatch")
            violations = connection.execute("PRAGMA foreign_key_check").fetchone()
            if violations:
                raise ValueError("d1_foreign_key_check_failed")
            destination.mkdir(mode=0o700, parents=True)
            rows_total = 0
            manifest_tables = []
            try:
                for name in tables:
                    quoted = '"' + name.replace('"', '""') + '"'
                    metadata = connection.execute(
                        "PRAGMA table_info(" + quoted + ")"
                    ).fetchall()
                    columns = [row[1] for row in metadata]
                    if not columns or any(
                        not ALLOW_NAME.fullmatch(x) for x in columns
                    ):
                        raise ValueError("d1_column_inventory_invalid")
                    filename = name + ".jsonl"
                    sha = hashlib.sha256()
                    count = 0
                    with (destination / filename).open("wb") as output:
                        ordered_cols = ",".join('"' + col + '"' for col in columns)
                        for data in connection.execute("SELECT " + ordered_cols + " FROM " + quoted):
                            record = json.dumps({
                                columns[i]: safe_value(value)
                                for i, value in enumerate(data)
                            }, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n"
                            output.write(record)
                            sha.update(record)
                            count += 1
                    manifest_tables.append({
                        "name": name, "file": filename, "columns": columns,
                        "rows": count, "sha256": sha.hexdigest()
                    })
                    rows_total += count
                manifest = {
                    "format": "rd-connect-d1-jsonl-v1",
                    "source": "trusted-local-wrangler-d1-sql",
                    "table_count": len(tables),
                    "total_rows": rows_total,
                    "tables": manifest_tables
                }
                (destination / "manifest.json").write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2),
                    encoding="utf-8"
                )
            except BaseException:
                shutil.rmtree(destination, ignore_errors=True)
                raise
            return len(tables), rows_total
        finally:
            connection.close()


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT private local D1 SQL to JSONL")
    parser.add_argument("--source-sql", required=True,
                        help="Trusted local D1 SQL dump exported by Wrangler")
    parser.add_argument("--output", required=True,
                        help="New private output directory (must not already exist)")
    parser.add_argument("--export-local", action="store_true",
                        help="Explicitly confirm that this writes sensitive local JSONL")
    args = parser.parse_args()
    if not args.export_local:
        print("BLOCKED: explicitly add --export-local for sensitive LOCAL files.", file=sys.stderr)
        return 2
    try:
        total, rows = export_dump(args.source_sql, args.output)
    except Exception as error:
        # Do not print SQL text, credentials, row values or filesystem contents.
        reason = str(error)
        if reason not in {
            "output_directory_already_exists", "trusted_d1_dump_not_found",
            "d1_table_inventory_mismatch", "d1_foreign_key_check_failed",
            "d1_column_inventory_invalid", "unsupported_sqlite_value"
        }:
            reason = "offline_export_failed"
        print("LOCAL EXPORT FAILED (" + reason + ").", file=sys.stderr)
        return 1
    print("LOCAL D1 EXPORT OK: %d tables, %d rows. NO NETWORK; handle output as confidential school data." % (total, rows))
    print("NEXT: keep manifest and *.jsonl PRIVATE; run Node dry-run migration plan, do not import yet.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
