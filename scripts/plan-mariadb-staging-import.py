#!/usr/bin/env python3
"""RD CONNECT SQLite -> MariaDB staging import planner (NO WRITES).

Consumes only locally created schema/count metadata:
 - sqlite-backup-inventory.py --report JSON (63 tables, 119 foreign key links)
 - phpMyAdmin information_schema.COLUMNS extended CSV
 - phpMyAdmin information_schema.KEY_COLUMN_USAGE + FK rules CSV

Builds parent-before-child ordering, explicit column bindings excluding
STORED GENERATED, and safe counts. No student rows, tokens, credentials or
SQL containing actual data. Does not connect to SQLite or MariaDB.
This is NOT permission to import to a real database.
"""
import argparse
import collections
import csv
import heapq
import json
import re
import sys
from pathlib import Path

IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
FORMAT = "rd-connect-sqlite-backup-inventory-v1"
SRC_LEDGER = "school_schema_migrations"
DST_LEDGER = "d1_migrations"
EXPECTED_GENERATED = {
    "students": {"live_classroom_id", "live_roll_no"},
    "student_enrollments": {
        "current_student_id", "current_classroom_id", "current_roll_no"
    },
}
COLUMNS_REQUIRED = {
    "TABLE_NAME", "COLUMN_NAME", "DATA_TYPE", "COLUMN_TYPE",
    "IS_NULLABLE", "EXTRA", "CHARACTER_MAXIMUM_LENGTH",
    "NUMERIC_PRECISION", "NUMERIC_SCALE", "DATETIME_PRECISION",
}
FKS_REQUIRED = {
    "TABLE_NAME", "CONSTRAINT_NAME", "ORDINAL_POSITION", "COLUMN_NAME",
    "REFERENCED_TABLE_NAME", "REFERENCED_COLUMN_NAME",
    "UPDATE_RULE", "DELETE_RULE",
}


def assert_id(name):
    if not isinstance(name, str) or not IDENT.fullmatch(name):
        raise ValueError("unexpected_table_or_column_name")
    return name


def read_csv(filename, required):
    with Path(filename).open(newline="", encoding="utf-8-sig") as file:
        reader = csv.DictReader(file)
        if not reader.fieldnames:
            raise ValueError("missing_csv_headers")
        reader.fieldnames = [h.strip().strip("\ufeff") for h in reader.fieldnames]
        if not required.issubset(reader.fieldnames):
            raise ValueError("wrong_csv_headers")
        rows = list(reader)
    if any(None in row for row in rows):
        raise ValueError("invalid_csv_rows")
    return rows


def read_sqlite_inventory(filename):
    with Path(filename).open(encoding="utf-8-sig") as file:
        inventory = json.load(file)
    if (inventory.get("format") != FORMAT or
        inventory.get("sqlite_integrity") != "ok" or
        inventory.get("sqlite_foreign_keys") != "ok" or
        inventory.get("table_count") != 63):
        raise ValueError("unverified_sqlite_inventory")
    items = inventory.get("tables")
    if not isinstance(items, list) or len(items) != 63:
        raise ValueError("invalid_sqlite_inventory")
    tables = {}
    for table in items:
        name = assert_id(table.get("table"))
        if name in tables:
            raise ValueError("duplicate_source_table")
        cols = table.get("columns")
        fk = table.get("foreign_keys")
        count = table.get("rows")
        if (not isinstance(cols, list) or not cols or
            not isinstance(fk, list) or type(count) is not int or count < 0):
            raise ValueError("incomplete_source_metadata")
        names = []
        for entry in cols:
            column = assert_id(entry.get("name"))
            names.append(column)
        if len(set(names)) != len(names):
            raise ValueError("duplicate_source_column")
        parents = set()
        for entry in fk:
            if not isinstance(entry, dict):
                raise ValueError("incomplete_source_fk")
            parent = assert_id(entry.get("parent_table"))
            assert_id(entry.get("child_column"))
            assert_id(entry.get("parent_column"))
            if entry["child_column"] not in names:
                raise ValueError("source_fk_column_missing")
            parents.add(parent)
        tables[name] = {
            "rows": count, "columns": names, "parents": parents,
            "fk_parts": len(fk),
        }
    if SRC_LEDGER not in tables or DST_LEDGER in tables:
        raise ValueError("missing_or_unexpected_sqlite_migration_ledger")
    return tables


def read_target_columns(filename):
    columns = {}
    for row in read_csv(filename, COLUMNS_REQUIRED):
        table = assert_id((row.get("TABLE_NAME") or "").strip())
        name = assert_id((row.get("COLUMN_NAME") or "").strip())
        colset = columns.setdefault(table, {})
        if name in colset:
            raise ValueError("duplicate_target_column")
        colset[name] = {
            "generated": "generated" in (row.get("EXTRA") or "").lower(),
            "type": (row.get("DATA_TYPE") or "").lower(),
        }
    if len(columns) != 63 or DST_LEDGER not in columns or SRC_LEDGER in columns:
        raise ValueError("target_schema_missing_tables")
    return columns


def read_target_fk_parts(filename):
    rows = read_csv(filename, FKS_REQUIRED)
    group = {}
    for row in rows:
        table = assert_id((row.get("TABLE_NAME") or "").strip())
        parent = assert_id((row.get("REFERENCED_TABLE_NAME") or "").strip())
        cname = assert_id((row.get("CONSTRAINT_NAME") or "").strip())
        childcol = assert_id((row.get("COLUMN_NAME") or "").strip())
        parentcol = assert_id((row.get("REFERENCED_COLUMN_NAME") or "").strip())
        ordinal = (row.get("ORDINAL_POSITION") or "").strip()
        if not ordinal.isdecimal() or int(ordinal) < 1:
            raise ValueError("invalid_target_fk_order")
        key = (table, cname)
        g = group.setdefault(key, {"parent": parent, "columns": {}})
        if g["parent"] != parent or int(ordinal) in g["columns"]:
            raise ValueError("duplicate_or_inconsistent_target_fk")
        g["columns"][int(ordinal)] = (childcol, parentcol)
    if len(group) != 119 or len(rows) != 123:
        raise ValueError("target_fk_count_unexpected")
    return group


def topological_order(data):
    parents = {table: set(info["parents"]) for table, info in data.items()}
    children = {t: set() for t in parents}
    selfrefs = []
    for table, referenced in parents.items():
        for parent in tuple(referenced):
            if parent == table:
                selfrefs.append(table)
                referenced.remove(parent)
            elif parent not in parents:
                raise ValueError("unresolved_parent_reference")
            else:
                children[parent].add(table)
    indeg = {table: len(deps) for table, deps in parents.items()}
    available = [table for table, count in indeg.items() if count == 0]
    heapq.heapify(available)
    order = []
    while available:
        parent = heapq.heappop(available)
        order.append(parent)
        for child in children[parent]:
            indeg[child] -= 1
            if indeg[child] == 0:
                heapq.heappush(available, child)
    cycles = sorted(set(parents) - set(order))
    return order, cycles, sorted(set(selfrefs))


def plan(source, target, target_fks):
    data = {table: values for table, values in source.items() if table != SRC_LEDGER}
    expected_tables = set(data)
    actual_tables = set(target) - {DST_LEDGER}
    if expected_tables != actual_tables:
        raise ValueError("source_target_table_names_differ")
    steps = {}
    generated = {}
    for table, info in data.items():
        source_cols = info["columns"]
        dest = target[table]
        unknown = set(source_cols) - set(dest)
        if unknown:
            raise ValueError("target_missing_source_column")
        additional = set(dest) - set(source_cols)
        if additional != EXPECTED_GENERATED.get(table, set()):
            raise ValueError("unexpected_target_generated_columns")
        if any(not dest[name]["generated"] for name in additional):
            raise ValueError("non_generated_extra_target_column")
        if any(dest[name]["generated"] for name in source_cols):
            raise ValueError("source_column_is_generated_in_target")
        steps[table] = {
            "table": table,
            "rows_expected": info["rows"],
            "columns_to_bind": list(source_cols),
            "generated_columns_skipped": sorted(additional),
            "fk_column_parts": info["fk_parts"],
        }
        if additional:
            generated[table] = sorted(additional)
    order, cycles, selfrefs = topological_order(data)
    source_fk_parts = sum(v["fk_parts"] for v in data.values())
    if source_fk_parts != 123:
        raise ValueError("source_fk_count_unexpected")
    dest_parent_parts = collections.Counter()
    for (table, _), g in target_fks.items():
        dest_parent_parts[(table, g["parent"])] += len(g["columns"])
    src_parent_parts = collections.Counter()
    for table, info in data.items():
        # Source inventory only carries per-column FK entries; preserve counts in this stage
        # and rely on the separate strict FK checker for composite relationships.
        for parent in info["parents"]:
            src_parent_parts[(table, parent)] += 1
    if set(dest_parent_parts) != set(src_parent_parts):
        raise ValueError("source_target_fk_parent_links_differ")
    target_order_links = sum(len(g["columns"]) for g in target_fks.values())
    if target_order_links != 123:
        raise ValueError("target_fk_parts_mismatch")
    return {
        "format": "rd-connect-mariadb-stage-plan-v1",
        "import_authorized": False,
        "tables_to_import": len(data),
        "source_rows_to_import": sum(v["rows"] for v in data.values()),
        "excluded_migration_ledger": SRC_LEDGER,
        "target_ledger_reserved": DST_LEDGER,
        "generated_columns_excluded": generated,
        "source_foreign_key_parts": source_fk_parts,
        "target_foreign_key_parts": target_order_links,
        "ready_for_fk_ordered_import": not cycles and not selfrefs,
        "cycles": cycles,
        "self_referencing_tables": selfrefs,
        "insert_steps": [steps[table] for table in order],
        "unresolved_tables": sorted(set(data)-set(order)),
        "unresolved_prerequisites": [
            "generated_expression_metadata_comparison",
            "mariadb_unique_and_collation_actual_checks",
            "mariadb_check_constraints_and_triggers",
            "empty_dedicated_test_database_proven",
            "backend_mariadb_adapter_and_login_regression",
            "reconciliation_and_rollback_test",
        ],
    }


def safe_save(target, payload):
    output = Path(target).expanduser()
    if output.exists() or not output.parent.is_dir() or output.is_symlink():
        raise ValueError("output_must_be_new_file_in_existing_private_folder")
    parent = output.parent.resolve()
    if any((p / ".git").exists() for p in (parent, *parent.parents)):
        raise ValueError("output_must_be_outside_git")
    if "public_html" in parent.parts:
        raise ValueError("output_must_be_outside_webroot")
    with output.open("x", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def main():
    parser = argparse.ArgumentParser(description="RD CONNECT offline import-plan dry run")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_extended_csv")
    parser.add_argument("mariadb_foreign_keys_csv")
    parser.add_argument("--report", help="Optional NEW local metadata-only JSON file")
    args = parser.parse_args()
    try:
        report = plan(read_sqlite_inventory(args.sqlite_schema_json),
                      read_target_columns(args.mariadb_columns_extended_csv),
                      read_target_fk_parts(args.mariadb_foreign_keys_csv))
        if args.report:
            safe_save(args.report, report)
    except (ValueError, OSError, UnicodeError, csv.Error, json.JSONDecodeError,
            TypeError, KeyError):
        print("STAGING PLAN BLOCKED: metadata does not match required verified schema.",
              file=sys.stderr)
        return 1
    print("RD CONNECT SQLITE -> MARIADB STAGING IMPORT PLAN: NO DB WRITES")
    print("TABLES_TO_IMPORT:", report["tables_to_import"])
    print("SOURCE_ROWS_TO_IMPORT:", report["source_rows_to_import"])
    print("FK_PARTS:", report["source_foreign_key_parts"])
    print("GENERATED_COLUMNS_SKIPPED:",
          sum(len(v) for v in report["generated_columns_excluded"].values()))
    print("ORDERED_TABLES:", len(report["insert_steps"]))
    print("TABLE_DEPENDENCY_CYCLES:", len(report["cycles"]))
    print("SELF_REFERENCING_TABLES:", len(report["self_referencing_tables"]))
    print("ORDER_PLAN_POSSIBLE:", report["ready_for_fk_ordered_import"])
    print("IMPORT_AUTHORIZED: NO")
    if args.report:
        print("METADATA_ONLY_STAGING_PLAN_SAVED: YES")
    print("NOT CHECKED: actual inserts, SQL CHECK/triggers, collations,")
    print("generated expressions, lock/cutover behavior and app compatibility.")
    print("NO STUDENT ROWS READ; NO DB CONNECTIONS OR WRITES.")
    return 2 if not report["ready_for_fk_ordered_import"] else 0


if __name__=="__main__":
    sys.exit(main())
