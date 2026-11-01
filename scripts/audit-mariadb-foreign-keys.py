#!/usr/bin/env python3
"""RD CONNECT offline SQLite <-> MariaDB Foreign Key metadata audit.

Reads a verified immutable SQLite backup plus phpMyAdmin INFORMATION_SCHEMA
KEY_COLUMN_USAGE/REFERENTIAL_CONSTRAINTS CSV. Does not connect to MariaDB,
modify SQLite, upload private data, or authorize a migration.
"""
import argparse
import collections
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path

RE_BACKUP = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T[^/\\]*\.sqlite$", re.I)
RE_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
FIELDS = {
    "TABLE_NAME", "CONSTRAINT_NAME", "ORDINAL_POSITION",
    "COLUMN_NAME", "REFERENCED_TABLE_NAME", "REFERENCED_COLUMN_NAME",
    "UPDATE_RULE", "DELETE_RULE",
}
LEDGER_SQLITE = "school_schema_migrations"
LEDGER_MARIA = "d1_migrations"
RULES = {"CASCADE", "RESTRICT", "NO ACTION", "SET NULL", "SET DEFAULT"}
SOURCE_FORMAT = "rd-connect-sqlite-backup-inventory-v1"


def ident(value):
    if not isinstance(value, str) or not RE_IDENT.fullmatch(value):
        raise ValueError("invalid_identifier")
    return '"' + value + '"'


def validate_manifest(path):
    with Path(path).open(encoding="utf-8-sig") as stream:
        obj = json.load(stream)
    if (obj.get("format") != SOURCE_FORMAT or
            obj.get("sqlite_integrity") != "ok" or
            obj.get("sqlite_foreign_keys") != "ok" or
            obj.get("table_count") != 63):
        raise ValueError("invalid_sqlite_inventory")
    tables = obj.get("tables")
    if not isinstance(tables, list) or len(tables) != 63:
        raise ValueError("invalid_sqlite_inventory")
    names = [t.get("table") for t in tables]
    if (len(set(names)) != 63 or
        any(not isinstance(n, str) or not RE_IDENT.fullmatch(n) for n in names) or
        LEDGER_SQLITE not in names):
        raise ValueError("invalid_sqlite_inventory")
    return set(names)


def target_constraints(path):
    groups = {}
    with Path(path).open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("fk_csv_header_missing")
        reader.fieldnames = [x.strip().strip("\ufeff") for x in reader.fieldnames]
        if not FIELDS.issubset(reader.fieldnames):
            raise ValueError("fk_csv_columns_missing")
        for row in reader:
            if None in row:
                raise ValueError("fk_csv_extra_values")
            table = (row["TABLE_NAME"] or "").strip()
            constraint = (row["CONSTRAINT_NAME"] or "").strip()
            column = (row["COLUMN_NAME"] or "").strip()
            parent = (row["REFERENCED_TABLE_NAME"] or "").strip()
            parentcol = (row["REFERENCED_COLUMN_NAME"] or "").strip()
            seq = (row["ORDINAL_POSITION"] or "").strip()
            update = (row["UPDATE_RULE"] or "").strip().upper()
            delete = (row["DELETE_RULE"] or "").strip().upper()
            for value in (table, constraint, column, parent, parentcol):
                ident(value)
            if (not seq.isdecimal() or int(seq) < 1 or update not in RULES
                    or delete not in RULES):
                raise ValueError("fk_csv_invalid_values")
            group = groups.setdefault((table, constraint), {
                "parent": parent, "update": update, "delete": delete,
                "parts": {},
            })
            if (group["parent"] != parent or group["update"] != update
                    or group["delete"] != delete or int(seq) in group["parts"]):
                raise ValueError("fk_csv_inconsistent_group")
            group["parts"][int(seq)] = (column, parentcol)
    if not groups:
        raise ValueError("fk_csv_empty")
    relations = []
    for (table, constraint), group in groups.items():
        positions = sorted(group["parts"])
        if positions != list(range(1, len(positions)+1)):
            raise ValueError("fk_csv_sequence_invalid")
        columns = tuple(group["parts"][pos][0] for pos in positions)
        references = tuple(group["parts"][pos][1] for pos in positions)
        relations.append((
            table, columns, group["parent"], references,
            group["update"], group["delete"],
        ))
    return relations, len(groups), sum(len(g["parts"]) for g in groups.values())


def source_constraints(backup_path, allowed_tables):
    path = Path(backup_path).expanduser()
    if (path.is_symlink() or not RE_BACKUP.fullmatch(path.name) or
            not path.is_file() or path.stat().st_size < 4096):
        raise ValueError("verified_backup_required")
    rels = []
    with sqlite3.connect(path.resolve().as_uri()+"?mode=ro&immutable=1", uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        live_tables = {
            name for (name,) in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        }
        if live_tables != allowed_tables:
            raise ValueError("backup_tables_differ_from_inventory")
        for table in sorted(allowed_tables - {LEDGER_SQLITE}):
            groups = {}
            for row in db.execute("PRAGMA foreign_key_list("+ident(table)+")"):
                # id, seq, table, from, to, on_update, on_delete, match
                fid, seq, parent, column, parentcol, update, delete, _ = row
                if not isinstance(parentcol, str) or not parentcol:
                    raise ValueError("implicit_parent_pk_fk_needs_review")
                for identifier in (parent, column, parentcol):
                    ident(identifier)
                if update.upper() not in RULES or delete.upper() not in RULES:
                    raise ValueError("unknown_sqlite_fk_action")
                group = groups.setdefault(fid, {
                    "parent": parent, "update": update.upper(),
                    "delete": delete.upper(), "parts": {},
                })
                if (group["parent"] != parent or
                    group["update"] != update.upper() or
                    group["delete"] != delete.upper() or
                    seq in group["parts"]):
                    raise ValueError("sqlite_fk_invalid")
                group["parts"][seq] = (column, parentcol)
            for group in groups.values():
                positions = sorted(group["parts"])
                if positions != list(range(len(positions))):
                    raise ValueError("sqlite_fk_order_invalid")
                rels.append((
                    table,
                    tuple(group["parts"][i][0] for i in positions),
                    group["parent"],
                    tuple(group["parts"][i][1] for i in positions),
                    group["update"], group["delete"],
                ))
    return rels


def analyze(source, target):
    src = collections.Counter(source)
    dst = collections.Counter(target)
    missing = sorted((src-dst).elements())
    extra = sorted((dst-src).elements())
    def serial(item):
        table, columns, parent, refcols, update, delete = item
        return (table+"("+",".join(columns)+")->"+
                parent+"("+",".join(refcols)+") "+
                "UPDATE="+update+" DELETE="+delete)
    return {
        "source_fks": len(source), "target_fks": len(target),
        "missing": [serial(x) for x in missing],
        "extra": [serial(x) for x in extra],
    }


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT read-only FK schema audit")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_foreign_keys_csv")
    args = parser.parse_args()
    try:
        manifest = validate_manifest(args.sqlite_schema_json)
        dest, constraints, part_count = target_constraints(args.mariadb_foreign_keys_csv)
        source = source_constraints(args.backup_file, manifest)
        if any(ref[0] == LEDGER_MARIA for ref in dest):
            raise ValueError("unexpected_fk_on_migration_ledger")
        result = analyze(source, dest)
    except (ValueError, OSError, UnicodeError, sqlite3.Error,
            csv.Error, json.JSONDecodeError, TypeError) as error:
        reasons = {
            "invalid_identifier", "invalid_sqlite_inventory",
            "fk_csv_header_missing", "fk_csv_columns_missing",
            "fk_csv_extra_values", "fk_csv_invalid_values",
            "fk_csv_inconsistent_group", "fk_csv_empty",
            "fk_csv_sequence_invalid", "verified_backup_required",
            "backup_integrity_failed", "backup_foreign_keys_failed",
            "backup_tables_differ_from_inventory",
            "implicit_parent_pk_fk_needs_review", "unknown_sqlite_fk_action",
            "sqlite_fk_invalid", "sqlite_fk_order_invalid",
            "unexpected_fk_on_migration_ledger",
        }
        message = str(error)
        print("FOREIGN KEY AUDIT BLOCKED: " + (
            message if message in reasons else "input_not_readable"
        ), file=sys.stderr)
        return 1
    print("RD CONNECT SQLITE/MARIADB FOREIGN KEY AUDIT: READ ONLY")
    print("SQLITE_FKS:", result["source_fks"])
    print("MARIADB_FKS:", result["target_fks"])
    print("MARIADB_FK_PART_ROWS:", part_count)
    print("MISSING_IN_MARIADB:", len(result["missing"]))
    for x in result["missing"][:60]:
        print(" -", x)
    print("EXTRA_IN_MARIADB:", len(result["extra"]))
    for x in result["extra"][:60]:
        print(" -", x)
    print("NOT VERIFIED: MariaDB INSERT order, FK sign/type compatibility,")
    print("COLLATION, generated columns, CHECK constraints or trigger behavior.")
    print("NO NETWORK; NO DATA VALUES EXPORTED; NO SQLITE/MARIADB WRITES.")
    return 2 if result["missing"] or result["extra"] else 0


if __name__=="__main__":
    sys.exit(main())
