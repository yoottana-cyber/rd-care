#!/usr/bin/env python3
"""RD CONNECT MariaDB LAB Foreign Key repair: offline plans only.

Modes:
  --preflight-sql NEWFILE: generate read-only exact COUNT SQL (67 rows).
  --prepare-alters NEWFILE --lab-counts-csv CSV:
       only after verified empty lab/counts, generate 119 ALTER statements.
No network, no database connection, and never executes ALTER itself.
Requires verified SQLite backup, inventory and original 119 FK source metadata.
"""
import argparse
import csv
import importlib.util
import json
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("rd_fk_audit", HERE/"audit-mariadb-foreign-keys.py")
FK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FK)
LAB = "ratsadaa_connect_lab"
SOURCE_DB = "ratsadaa_connect"
EXCLUDE_ACTIONS = {"SET DEFAULT"}
EXPECTED_TABLES = 63
EXPECTED_FKS = 119
EXPECTED_PARTS = 123


def schema_tables(inventory_path):
    names = FK.validate_manifest(inventory_path)
    if len(names) != EXPECTED_TABLES or FK.LEDGER_SQLITE not in names:
        raise ValueError("source_inventory_invalid")
    return sorted((names - {FK.LEDGER_SQLITE}) | {FK.LEDGER_MARIA})


def safe_write(path, data):
    dest = Path(path).expanduser()
    if dest.is_symlink() or dest.exists() or not dest.parent.is_dir():
        raise ValueError("output_must_be_new_file")
    parent = dest.parent.resolve()
    if any((folder/".git").exists() for folder in (parent,*parent.parents)):
        raise ValueError("output_must_be_outside_git")
    if any(part.lower()=="public_html" for part in parent.parts):
        raise ValueError("output_must_be_outside_webroot")
    with dest.open("x", encoding="utf-8") as handle:
        handle.write(data)


def qident(name):
    if not FK.RE_IDENT.fullmatch(name):
        raise ValueError("bad_sql_identifier")
    return chr(96)+name+chr(96)


def preflight_sql(tables):
    if len(tables)!=EXPECTED_TABLES or len(set(tables))!=len(tables):
        raise ValueError("unexpected_table_manifest")
    s = qident(LAB)
    queries = [
        "SELECT 'TABLE_ROWS' AS KIND, '"+name+"' AS NAME, COUNT(*) AS N "
        "FROM "+s+"."+qident(name) for name in tables
    ]
    queries += [
        "SELECT 'TABLE_COUNT', 'all', COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA='"+LAB+"' AND TABLE_TYPE='BASE TABLE'",
        "SELECT 'FK_COUNT', 'all', COUNT(DISTINCT TABLE_NAME, CONSTRAINT_NAME) "
        "FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='"+LAB+
        "' AND REFERENCED_TABLE_NAME IS NOT NULL",
        "SELECT 'GENERATED_COUNT', 'all', COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA='"+LAB+"' AND LOWER(EXTRA) LIKE '%generated%'",
        "SELECT 'TRIGGER_COUNT', 'all', COUNT(*) FROM information_schema.TRIGGERS "
        "WHERE TRIGGER_SCHEMA='"+LAB+"'",
    ]
    return (
        "-- RD CONNECT LAB ONLY / READ ONLY. Exactly 67 result rows.\n"
        "-- Export query RESULTS to comma CSV with KIND,NAME,N header.\n"
        +"\nUNION ALL\n".join(queries)+"\nORDER BY KIND,NAME;\n"
    )


def verify_preflight(path, tables):
    src = Path(path)
    if not src.is_file():
        raise ValueError("lab_counts_csv_missing")
    if not src.stat().st_size:
        raise ValueError("lab_counts_csv_empty")
    seen = {}
    with src.open(newline="",encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("lab_counts_header_missing")
        reader.fieldnames = [v.strip().strip("\ufeff").upper() for v in reader.fieldnames]
        if reader.fieldnames != ["KIND","NAME","N"]:
            raise ValueError("lab_counts_wrong_csv_header")
        for row in reader:
            if None in row:
                raise ValueError("lab_counts_bad_csv")
            kind,name,count = (row["KIND"] or "").strip(), (row["NAME"] or "").strip(), (row["N"] or "").strip()
            key=(kind,name)
            if key in seen or not count.isdecimal():
                raise ValueError("lab_counts_duplicate_or_invalid")
            seen[key]=int(count)
    expected = {("TABLE_ROWS",n) for n in tables}
    expected.update((kind,"all") for kind in ("TABLE_COUNT","FK_COUNT","GENERATED_COUNT","TRIGGER_COUNT"))
    if set(seen)!=expected:
        raise ValueError("lab_counts_incomplete_or_wrong_database")
    if (seen[("TABLE_COUNT","all")]!=EXPECTED_TABLES or
        seen[("FK_COUNT","all")]!=0 or
        seen[("GENERATED_COUNT","all")]!=5 or
        seen[("TRIGGER_COUNT","all")]!=0):
        raise ValueError("lab_schema_not_ready_for_fk_repair")
    if any(seen[("TABLE_ROWS",n)]!=0 for n in tables):
        raise ValueError("lab_contains_data_do_not_change")
    return seen


def verify_source(backup, inventory, fkcsv):
    tables = FK.validate_manifest(inventory)
    from_sqlite=FK.source_constraints(backup,tables)
    relations, fks, parts = FK.target_constraints(fkcsv)
    if fks!=EXPECTED_FKS or parts!=EXPECTED_PARTS or len(from_sqlite)!=EXPECTED_FKS:
        raise ValueError("fk_source_count_mismatch")
    if FK.deferred_fk_tables(backup):
        raise ValueError("sqlite_deferred_fk_needs_manual_review")
    diff=FK.analyze(from_sqlite,relations)
    if diff["missing"] or diff["extra"]:
        raise ValueError("sqlite_mariadb_fk_metadata_different")
    if any(u in EXCLUDE_ACTIONS or d in EXCLUDE_ACTIONS for *_,u,d in relations):
        raise ValueError("fk_set_default_unsupported")
    return fks, parts


def read_fk_groups(path):
    groups={}
    with Path(path).open(newline="",encoding="utf-8-sig") as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("fk_csv_header_missing")
        reader.fieldnames=[x.strip().strip("\ufeff") for x in reader.fieldnames]
        if not FK.FIELDS.issubset(reader.fieldnames):
            raise ValueError("fk_csv_columns_missing")
        for row in reader:
            if None in row:
                raise ValueError("fk_csv_extra_values")
            table,name,parent,col,refcol=(
                (row.get(field) or "").strip() for field in
                ("TABLE_NAME","CONSTRAINT_NAME","REFERENCED_TABLE_NAME",
                 "COLUMN_NAME","REFERENCED_COLUMN_NAME")
            )
            for ident in (table,name,parent,col,refcol):
                qident(ident)
            seq=(row["ORDINAL_POSITION"] or "").strip()
            if not seq.isdecimal() or int(seq)<=0:
                raise ValueError("bad_fk_position")
            update=(row["UPDATE_RULE"] or "").strip().upper()
            delete=(row["DELETE_RULE"] or "").strip().upper()
            if update not in FK.RULES or delete not in FK.RULES:
                raise ValueError("bad_fk_rule")
            key=(table,name)
            group=groups.setdefault(key,{"parent":parent,"update":update,"delete":delete,"parts":{}})
            if (group["parent"]!=parent or group["update"]!=update or
                group["delete"]!=delete or int(seq) in group["parts"]):
                raise ValueError("inconsistent_fk_group")
            group["parts"][int(seq)]=(col,refcol)
    if len(groups)!=EXPECTED_FKS:
        raise ValueError("wrong_fk_group_count")
    return groups


def prepare_alters(groups, tables):
    allowed=set(tables)
    statement=[]
    for (table,name),g in sorted(groups.items()):
        parts=g["parts"]
        nums=sorted(parts)
        if nums!=list(range(1,len(parts)+1)):
            raise ValueError("bad_fk_part_order")
        if table not in allowed or g["parent"] not in allowed:
            raise ValueError("fk_points_outside_lab_tables")
        if g["update"] in EXCLUDE_ACTIONS or g["delete"] in EXCLUDE_ACTIONS:
            raise ValueError("unsupported_fk_action")
        children=", ".join(qident(parts[n][0]) for n in nums)
        parents=", ".join(qident(parts[n][1]) for n in nums)
        statement.append(
            "ALTER TABLE "+qident(LAB)+"."+qident(table)+
            " ADD CONSTRAINT "+qident(name)+
            " FOREIGN KEY ("+children+") REFERENCES "+
            qident(LAB)+"."+qident(g["parent"])+" ("+parents+")"+
            " ON UPDATE "+g["update"]+" ON DELETE "+g["delete"]+";"
        )
    if len(statement)!=EXPECTED_FKS:
        raise ValueError("fk_statement_count_incorrect")
    return (
        "-- MariaDB LAB ONLY: manual execution AFTER exact 63-table empty gate.\n"
        "-- DDL auto-commits: partial failures require manual review.\n"
        "-- Never execute against ratsadaa_connect (staging) or live SQLite.\n"
        "-- DO NOT SET FOREIGN_KEY_CHECKS=0, DO NOT DROP tables.\n"
        +"\n".join(statement)+"\n"
    )


def main():
    p=argparse.ArgumentParser(description="RD CONNECT lab-only FK restoration SQL generator")
    p.add_argument("sqlite_backup")
    p.add_argument("sqlite_inventory_json")
    p.add_argument("mariadb_source_fk_csv")
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight-sql",metavar="NEWFILE")
    mode.add_argument("--prepare-alters",metavar="NEWFILE")
    p.add_argument("--lab-counts-csv",default=None)
    args=p.parse_args()
    try:
        tables=schema_tables(args.sqlite_inventory_json)
        count,parts=verify_source(args.sqlite_backup,args.sqlite_inventory_json,args.mariadb_source_fk_csv)
        if args.preflight_sql:
            safe_write(args.preflight_sql,preflight_sql(tables))
            print("RD CONNECT LAB FOREIGN KEY PREFLIGHT: READ-ONLY SELECT GENERATED")
            print("SOURCE_FKS:",count,"SOURCE_PARTS:",parts)
            print("LAB_SQL_CHECKS:",len(tables)+4)
            print("NO DATABASE CONNECTIONS/WRITES; IMPORT DISABLED.")
            return 0
        if not args.lab_counts_csv:
            raise ValueError("lab_counts_csv_required_before_alters")
        verify_preflight(args.lab_counts_csv,tables)
        groups=read_fk_groups(args.mariadb_source_fk_csv)
        output=prepare_alters(groups,tables)
        safe_write(args.prepare_alters,output)
        print("RD CONNECT LAB FOREIGN KEY ALTER SCRIPT PREPARED: NOT EXECUTED")
        print("TARGET_SCHEMA:",LAB)
        print("ALTER_STATEMENTS:",len(groups))
        print("VERIFIED_LAB_TABLES:",EXPECTED_TABLES)
        print("VERIFIED_EMPTY_TABLES:",EXPECTED_TABLES)
        print("SOURCE_FKS:",count,"SOURCE_PARTS:",parts)
        print("IMPORTANT: manual approval and phpMyAdmin execution still needed.")
        print("NO DATABASE CONNECTIONS/WRITES BY THIS SCRIPT.")
        return 0
    except (ValueError,OSError,UnicodeError,sqlite3.Error,csv.Error,json.JSONDecodeError,TypeError):
        print("LAB FK PREPARATION BLOCKED: required verified source/lab metadata missing or invalid.",
              file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
