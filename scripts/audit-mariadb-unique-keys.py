#!/usr/bin/env python3
"""RD CONNECT: private offline preflight for MariaDB UNIQUE key collisions.

Inputs: verified SQLite backup, SQLite schema inventory JSON, phpMyAdmin
extended COLUMNS CSV, and index-only STATISTICS CSV.
Read-only; no network; prints only metadata names and collision COUNTS.
This is NOT a full MySQL collation or generated-expression validator.
"""
import argparse
import csv
import json
import re
import sqlite3
import sys
from pathlib import Path

FILE_RE = re.compile(r"^rd-connect-\d{4}-\d{2}-\d{2}T[^/\\]*\.sqlite$", re.I)
IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
COL_FIELDS = {"TABLE_NAME", "COLUMN_NAME", "EXTRA"}
IDX_FIELDS = {"TABLE_NAME", "INDEX_NAME", "NON_UNIQUE", "SEQ_IN_INDEX",
              "COLUMN_NAME", "SUB_PART", "INDEX_TYPE"}


def name(value):
    if not isinstance(value, str) or not IDENT.fullmatch(value):
        raise ValueError("invalid_identifier")
    return '"' + value + '"'


def load_csv(filename, required):
    with Path(filename).open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise ValueError("missing_metadata_header")
        reader.fieldnames = [x.strip().strip("\ufeff") for x in reader.fieldnames]
        if not required.issubset(reader.fieldnames):
            raise ValueError("metadata_header_incomplete")
        return list(reader)


def read_metadata(schema_file, columns_file, indexes_file):
    with Path(schema_file).open(encoding="utf-8-sig") as stream:
        source = json.load(stream)
    if (source.get("format") != "rd-connect-sqlite-backup-inventory-v1"
        or source.get("sqlite_integrity") != "ok"
        or source.get("sqlite_foreign_keys") != "ok"
        or source.get("table_count") != 63):
        raise ValueError("invalid_sqlite_inventory")
    tables = source.get("tables")
    if not isinstance(tables, list) or len(tables) != 63:
        raise ValueError("invalid_sqlite_inventory")
    source_tables = {}
    for t in tables:
        table = t.get("table")
        columns = t.get("columns")
        if not isinstance(table, str) or not IDENT.fullmatch(table):
            raise ValueError("invalid_sqlite_inventory")
        if table in source_tables or not isinstance(columns, list):
            raise ValueError("invalid_sqlite_inventory")
        src_cols = [item.get("name") for item in columns]
        if (not src_cols or any(
            not isinstance(c, str) or not IDENT.fullmatch(c) for c in src_cols)
            or len(set(src_cols)) != len(src_cols)):
            raise ValueError("invalid_sqlite_inventory")
        source_tables[table] = {
            "columns": set(src_cols),
            "rows": t.get("rows"),
        }
        if type(t.get("rows")) is not int or t["rows"] < 0:
            raise ValueError("invalid_sqlite_inventory")
    cols = {}
    for row in load_csv(columns_file, COL_FIELDS):
        table = (row["TABLE_NAME"] or "").strip()
        column = (row["COLUMN_NAME"] or "").strip()
        if not IDENT.fullmatch(table) or not IDENT.fullmatch(column):
            raise ValueError("invalid_mariadb_columns")
        if column in cols.setdefault(table, {}):
            raise ValueError("duplicate_mariadb_column")
        cols[table][column] = "generated" in (row["EXTRA"] or "").lower()
    if len(cols) != 63:
        raise ValueError("invalid_mariadb_columns")
    if set(source_tables) - {"school_schema_migrations"} != set(cols) - {"d1_migrations"}:
        raise ValueError("target_tables_mismatch")
    indexes = {}
    for row in load_csv(indexes_file, IDX_FIELDS):
        table = (row["TABLE_NAME"] or "").strip()
        idx = (row["INDEX_NAME"] or "").strip()
        col = (row["COLUMN_NAME"] or "").strip()
        if not IDENT.fullmatch(table) or not idx or not IDENT.fullmatch(idx):
            raise ValueError("invalid_mariadb_index")
        if table not in cols:
            raise ValueError("index_table_unknown")
        if col and (not IDENT.fullmatch(col) or col not in cols[table]):
            raise ValueError("index_column_unknown")
        non_unique = (row["NON_UNIQUE"] or "").strip()
        seq = (row["SEQ_IN_INDEX"] or "").strip()
        if non_unique not in ("0", "1") or not seq.isdecimal() or int(seq)<1:
            raise ValueError("invalid_mariadb_index")
        idxkey = (table, idx)
        key = indexes.setdefault(idxkey, {"unique": non_unique == "0", "parts": {}})
        if key["unique"] != (non_unique == "0") or int(seq) in key["parts"]:
            raise ValueError("invalid_mariadb_index")
        sub = (row["SUB_PART"] or "").strip()
        if sub and (not sub.isdecimal() or int(sub)<1):
            raise ValueError("invalid_mariadb_index")
        key["parts"][int(seq)] = {
            "column": col,
            "prefix": bool(sub),
            "index_type": (row["INDEX_TYPE"] or "").strip().upper(),
        }
    if not indexes:
        raise ValueError("mariadb_index_inventory_empty")
    return source_tables, cols, indexes


def canonical(value):
    # Only a coarse approximation of case- and trailing-space-insensitive
    # MySQL collations; accent-insensitive Unicode / Thai sorting NOT modeled.
    if isinstance(value, str):
        return value.rstrip(" ").casefold()
    return value


def inspect_unique(backup, source, columns, indexes):
    p = Path(backup).expanduser()
    if (p.is_symlink() or not FILE_RE.fullmatch(p.name)
        or not p.is_file() or p.stat().st_size<4096):
        raise ValueError("verified_backup_required")
    result = {
        "unique_indexes_total":0,
        "unique_checked":0,
        "unique_skipped_generated":0,
        "unique_skipped_prefix":0,
        "unique_skipped_expression":0,
        "keys_evaluated":0,
        "exact_duplicate_groups":0,
        "potential_casefold_collisions":0,
        "issues":[],
    }
    with sqlite3.connect(p.resolve().as_uri()+"?mode=ro&immutable=1",uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall()!=[("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        for (table, idx), data in sorted(indexes.items()):
            if not data["unique"] or table == "d1_migrations":
                continue
            result["unique_indexes_total"]+=1
            parts = data["parts"]
            if sorted(parts) != list(range(1,len(parts)+1)):
                raise ValueError("index_part_order_invalid")
            keys = [parts[n]["column"] for n in sorted(parts)]
            if any(not col for col in keys):
                result["unique_skipped_expression"]+=1
                continue
            if any(parts[n]["prefix"] for n in parts):
                result["unique_skipped_prefix"]+=1
                continue
            if any(columns[table][col] for col in keys):
                result["unique_skipped_generated"]+=1
                continue
            if table not in source or any(col not in source[table]["columns"] for col in keys):
                raise ValueError("index_source_columns_missing")
            result["unique_checked"]+=1
            exact=set()
            approximate={}
            duplicates=0
            approx_collisions=0
            row_count=0
            query = "SELECT "+",".join(name(col) for col in keys)+" FROM "+name(table)
            for row in db.execute(query):
                row_count+=1
                if any(v is None for v in row):
                    continue  # MariaDB UNIQUE permits multiple NULL-containing keys.
                result["keys_evaluated"]+=1
                tup=tuple(row)
                if tup in exact:
                    duplicates+=1
                exact.add(tup)
                folded=tuple(canonical(v) for v in row)
                previous=approximate.get(folded)
                if previous is not None and previous != tup:
                    approx_collisions+=1
                else:
                    approximate[folded]=tup
            if row_count != source[table]["rows"]:
                raise ValueError("schema_backup_counts_mismatch")
            result["exact_duplicate_groups"]+=duplicates
            result["potential_casefold_collisions"]+=approx_collisions
            if duplicates or approx_collisions:
                result["issues"].append({
                    "table":table,"index":idx,"exact":duplicates,
                    "casefold":approx_collisions,
                })
    return result


def main():
    parser=argparse.ArgumentParser(description="RD CONNECT read-only unique index preflight")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_extended_csv")
    parser.add_argument("mariadb_indexes_csv")
    args=parser.parse_args()
    try:
        source,cols,indexes=read_metadata(
            args.sqlite_schema_json,args.mariadb_columns_extended_csv,
            args.mariadb_indexes_csv)
        r=inspect_unique(args.backup_file,source,cols,indexes)
    except (ValueError,OSError,UnicodeError,sqlite3.Error,csv.Error,json.JSONDecodeError,TypeError):
        print("UNIQUE INDEX AUDIT BLOCKED: metadata/backup invalid or incomplete.",
              file=sys.stderr)
        return 1
    print("RD CONNECT MARIADB UNIQUE INDEX AUDIT: READ ONLY")
    for k,v in r.items():
        if k!="issues": print(k.upper()+":",v)
    for entry in r["issues"]:
        print(" - "+entry["table"]+"."+entry["index"]+
              ": EXACT="+str(entry["exact"])+
              ", CASEFOLD_POTENTIAL="+str(entry["casefold"]))
    print("UNVERIFIED: generated expression indexes, prefix indexes, MySQL")
    print("collation equality (accent/Unicode/Thai), and actual INSERT constraints.")
    print("NO VALUES EXPORTED; NO NETWORK; NO DATABASE WRITES.")
    return 2 if r["issues"] else 0


if __name__=="__main__":
    sys.exit(main())
