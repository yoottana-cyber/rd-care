#!/usr/bin/env python3
"""RD CONNECT: offline audit of THREE known MariaDB generated UNIQUE indexes.

Read-only on an immutable, verified backup: checks the *intended* projected key
values from the original SQLite data, excluding soft-deleted/ended records.
Does not connect to MariaDB. Full MariaDB generation expressions and actual
uniqueness/collation semantics still require independent inspection.

Inputs: backup, SQLite inventory JSON, existing MariaDB extended COLUMNS CSV,
existing MariaDB STATISTICS CSV. Outputs only counts/index identifiers.
"""
import argparse
import importlib.util
import sqlite3
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
module_spec = importlib.util.spec_from_file_location(
    "rd_unique_index_base", HERE / "audit-mariadb-unique-keys.py"
)
base = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(base)

# Known projection rules from RD CONNECT SQLite migration schema.
# The actual MariaDB GENERATION_EXPRESSION is NOT in the existing metadata CSV.
EXPECTED = {
    ("students", ("live_classroom_id", "live_roll_no")): {
        "source_columns": ("classroom_id", "roll_no"),
        "active_condition": "deleted_at",
    },
    ("student_enrollments", ("current_student_id",)): {
        "source_columns": ("student_id",),
        "active_condition": "end_date",
    },
    ("student_enrollments", ("current_classroom_id", "current_roll_no")): {
        "source_columns": ("classroom_id", "roll_no"),
        "active_condition": "end_date",
    },
}


def scan(backup, source, target_columns, indexes):
    path = Path(backup).expanduser()
    if (path.is_symlink() or not base.FILE_RE.fullmatch(path.name)
            or not path.is_file() or path.stat().st_size < 4096):
        raise ValueError("verified_backup_required")
    found = {}
    unrecognized = []
    for (table, index), meta in sorted(indexes.items()):
        if not meta["unique"] or table == "d1_migrations":
            continue
        parts = meta["parts"]
        if sorted(parts) != list(range(1, len(parts)+1)):
            raise ValueError("invalid_index_sequence")
        names = tuple(parts[i]["column"] for i in sorted(parts))
        generated = any(
            target_columns[table].get(column, False)
            for column in names if column
        )
        if not generated:
            continue
        projected = EXPECTED.get((table, names))
        if projected is None or any(
            not column or parts[i]["prefix"] or
            parts[i]["index_type"] not in ("BTREE", "")
            for i, column in zip(sorted(parts), names)
        ):
            unrecognized.append((table, index))
            continue
        if (table, names) in found:
            raise ValueError("duplicate_expected_generated_index")
        found[(table, names)] = (index, projected)

    if unrecognized or set(found) != set(EXPECTED):
        return {
            "expected_indexes": len(EXPECTED), "matched_indexes": len(found),
            "unrecognized_indexes": unrecognized,
            "missing_projection_rules": sorted(set(EXPECTED) - set(found)),
            "checked_indexes": 0, "active_keys_checked": 0,
            "exact_duplicate_keys": 0, "potential_casefold_collisions": 0,
            "per_index": [],
            "safe_to_import": False,
        }

    counters = Counter()
    results = []
    with sqlite3.connect(path.resolve().as_uri()+"?mode=ro&immutable=1",uri=True) as db:
        db.execute("PRAGMA query_only=ON")
        if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise ValueError("backup_integrity_failed")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("backup_foreign_keys_failed")
        for (table, gen_columns), (idx_name, projected) in sorted(found.items()):
            src_columns = projected["source_columns"]
            active_col = projected["active_condition"]
            if (table not in source or
                any(column not in source[table]["columns"] for column in (*src_columns, active_col))):
                raise ValueError("missing_source_projection_column")
            current_rows = db.execute(
                "SELECT COUNT(*) FROM " + base.name(table)
            ).fetchone()[0]
            if current_rows != source[table]["rows"]:
                raise ValueError("inventory_row_count_mismatch")
            query = (
                "SELECT " + ", ".join(base.name(col) for col in src_columns) +
                " FROM " + base.name(table) +
                " WHERE " + base.name(active_col) + " IS NULL"
            )
            exact, approx = set(), {}
            checked, duplicates, folded_collisions, active = 0, 0, 0, 0
            for record in db.execute(query):
                active += 1
                if any(value is None for value in record):
                    continue  # MariaDB UNIQUE allows multiple keys containing NULL.
                if any(type(value) is not int for value in record):
                    raise ValueError("non_integer_generated_key_source")
                checked += 1
                key = tuple(record)
                if key in exact:
                    duplicates += 1
                exact.add(key)
                folded = tuple(base.canonical(value) for value in record)
                seen = approx.get(folded)
                if seen is not None and seen != key:
                    folded_collisions += 1
                else:
                    approx[folded] = key
            counters["active_keys_checked"] += checked
            counters["exact_duplicate_keys"] += duplicates
            counters["potential_casefold_collisions"] += folded_collisions
            results.append({
                "table": table, "index": idx_name,
                "active_rows": active, "evaluated_keys": checked,
                "exact_duplicates": duplicates,
                "casefold_collisions": folded_collisions,
            })

    return {
        "expected_indexes": len(EXPECTED),
        "matched_indexes": len(found),
        "unrecognized_indexes": [],
        "missing_projection_rules": [],
        "checked_indexes": len(results),
        "active_keys_checked": counters["active_keys_checked"],
        "exact_duplicate_keys": counters["exact_duplicate_keys"],
        "potential_casefold_collisions": counters["potential_casefold_collisions"],
        "per_index": results,
        "safe_to_import": False,
    }


def main():
    parser = argparse.ArgumentParser(
        description="RD CONNECT generated-UNIQUE offline projection audit"
    )
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_columns_extended_csv")
    parser.add_argument("mariadb_indexes_csv")
    args = parser.parse_args()
    try:
        source, cols, indexes = base.read_metadata(
            args.sqlite_schema_json,
            args.mariadb_columns_extended_csv,
            args.mariadb_indexes_csv,
        )
        report = scan(args.backup_file, source, cols, indexes)
    except (ValueError, OSError, TypeError, KeyError, UnicodeError, sqlite3.Error):
        print("GENERATED UNIQUE AUDIT BLOCKED: invalid metadata/backup or projected key type.",
              file=sys.stderr)
        return 1
    print("RD CONNECT GENERATED UNIQUE PROJECTION AUDIT: READ ONLY")
    for key in (
        "expected_indexes", "matched_indexes", "checked_indexes",
        "active_keys_checked", "exact_duplicate_keys",
        "potential_casefold_collisions",
    ):
        print(key.upper() + ":", report[key])
    print("UNRECOGNIZED_INDEXES:", len(report["unrecognized_indexes"]))
    for table, idx in report["unrecognized_indexes"]:
        print(" -", table+"."+idx)
    print("MISSING_PROJECTION_RULES:", len(report["missing_projection_rules"]))
    for table, generated_columns in report["missing_projection_rules"]:
        print(" -", table+"("+",".join(generated_columns)+")")
    for entry in report["per_index"]:
        print(" -", entry["table"]+"."+entry["index"],
              "ACTIVE_ROWS="+str(entry["active_rows"]),
              "CHECKED="+str(entry["evaluated_keys"]),
              "EXACT="+str(entry["exact_duplicates"]),
              "CASEFOLD="+str(entry["casefold_collisions"]))
    print("IMPORTANT: SOURCE-BASED PROJECTION ASSUMPTIONS ONLY; verify full")
    print("MariaDB GENERATION_EXPRESSION metadata, collation and actual INSERT behavior.")
    print("NO DATA VALUES EXPORTED; NO NETWORK; NO SQLITE/MARIADB WRITES; IMPORT DISABLED.")
    if report["matched_indexes"] != report["expected_indexes"]:
        return 2
    if report["exact_duplicate_keys"] or report["potential_casefold_collisions"]:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
