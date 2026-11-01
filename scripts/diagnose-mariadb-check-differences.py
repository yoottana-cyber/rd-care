#!/usr/bin/env python3
"""Offline CHECK differences: metadata-only diagnostics, never database writes.

Compares the SQLite CHECK clauses in the verified immutable backup to the
existing MariaDB information_schema constraints CSV. Output contains ONLY
schema identifiers and SQL syntax with quoted literals masked. Pairing of
unmatched checks is a heuristic for review, not proof of equivalent behavior.
"""
import argparse
import collections
import csv
import difflib
import importlib.util
import re
import sqlite3
import sys
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "audit-mariadb-check-parity.py"
SPEC = importlib.util.spec_from_file_location("rd_check_parity", SCRIPT)
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)

INTERESTING = (
    "glob", "regexp", "rlike", "like", "collate", "trim", "ltrim", "rtrim",
    "substr", "substring", "cast", "typeof", "coalesce", "ifnull",
    "json_valid", "json_extract", "length", "char_length", "date",
    "datetime", "strftime", "between", "in", "is null", "is not null",
    "and", "or", "not", "case", "when",
)


def redact_schema_expression(sql):
    """Preserve operators/identifiers; mask all SQL string literal contents."""
    out = []
    i = 0
    while i < len(sql):
        c = sql[i]
        end = base.skip_quote(sql, i)
        if end == i:
            out.append(c)
            i += 1
            continue
        if c in ("'", '"'):
            out.append("'[literal]'")
        elif c in (chr(96), "["):
            # Column identifiers are schema-only metadata.
            out.append(sql[i:end])
        else:
            out.append(" ")
        i = end
    return re.sub(r"\s+", " ", "".join(out)).strip()


def syntax_features(sql):
    """A hint list, not authoritative semantic classification."""
    text = base.canonical(sql)
    labels = set()
    for pattern in INTERESTING:
        compact = pattern.replace(" ", "")
        if re.search(r"(?<![a-z_])" + re.escape(compact) + r"(?![a-z_])", text):
            labels.add(pattern.upper().replace(" ", "_"))
    if "||" in text:
        labels.add("SQLITE_CONCAT_OPERATOR")
    if "!=" in text:
        labels.add("NOT_EQUAL_BANG")
    if "<>" in text:
        labels.add("NOT_EQUAL_ANGLE")
    if "==" in text:
        labels.add("DOUBLE_EQUALS")
    if re.search(r"\bREGEXP\b", sql, re.I):
        labels.add("REGEXP")
    return sorted(labels)


def differences(tables, target):
    src = {}
    for table, ddl in tables:
        if table != "school_schema_migrations":
            src[table] = base.sqlite_check_bodies(ddl or "")
    dst = collections.defaultdict(list)
    for table, constraint, clause in target["CHECK"]:
        if table == "d1_migrations":
            continue
        if table not in src:
            raise ValueError("unexpected_check_table")
        dst[table].append((constraint, clause))
    review = []
    for table in sorted(src):
        src_groups = collections.defaultdict(list)
        dst_groups = collections.defaultdict(list)
        for expression in src[table]:
            src_groups[base.canonical(expression)].append(expression)
        for name, expression in dst[table]:
            dst_groups[base.canonical(expression)].append((name, expression))
        for key in set(src_groups) & set(dst_groups):
            matched = min(len(src_groups[key]), len(dst_groups[key]))
            del src_groups[key][:matched]
            del dst_groups[key][:matched]
        source_unmatched = [e for group in src_groups.values() for e in group]
        target_unmatched = [e for group in dst_groups.values() for e in group]
        if not source_unmatched and not target_unmatched:
            continue
        # Greedy closest syntax matching only to assist human review.
        # Never declare pairs equivalent based on similarity.
        pairs = []
        available = target_unmatched[:]
        for s in source_unmatched:
            if available:
                idx = max(range(len(available)), key=lambda j: difflib.SequenceMatcher(
                    None, base.canonical(s), base.canonical(available[j][1])
                ).ratio())
                name, expr = available.pop(idx)
                pairs.append((s, name, expr))
            else:
                pairs.append((s, None, None))
        for name, expr in available:
            pairs.append((None, name, expr))
        review.append((table, pairs))
    return review


def main():
    parser = argparse.ArgumentParser(
        description="RD CONNECT CHECK clauses difference drilldown, read only"
    )
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_constraints_csv")
    args = parser.parse_args()
    try:
        tables, unused = base.base.read_source(args.backup_file,
                                               args.sqlite_schema_json)
        target = base.base.read_target(args.mariadb_constraints_csv)
        summary = base.compare(tables, target)
        unresolved = differences(tables, target)
        if sum(len(x) for _, x in unresolved) < max(
            summary["source_count"]-summary["matched_text"],
            summary["dest_count"]-summary["matched_text"]
        ):
            raise ValueError("inconsistent_check_diff_count")
    except (ValueError, OSError, UnicodeError, KeyError, TypeError,
            sqlite3.Error, csv.Error):
        print("CHECK DIFFERENCE DIAGNOSTIC BLOCKED: invalid metadata/backup.",
              file=sys.stderr)
        return 1

    print("RD CONNECT CHECK DIFFERENCE DIAGNOSTIC: READ ONLY")
    print("EXACT_MATCHES:", summary["matched_text"])
    print("UNMATCHED_SQLITE:", summary["source_count"]-summary["matched_text"])
    print("UNMATCHED_MARIADB:", summary["dest_count"]-summary["matched_text"])
    print("TABLES_NEEDING_REVIEW:", len(unresolved))
    for table, pairs in unresolved:
        print("TABLE:", table, "PAIRS_FOR_REVIEW:", len(pairs))
        for i, (sqlite_expr, name, maria_expr) in enumerate(pairs, 1):
            print("  PAIR", i, "TARGET_CHECK:", name or "(missing)")
            if sqlite_expr is not None:
                print("    SQLITE:", redact_schema_expression(sqlite_expr)[:600])
                print("    SQLITE_SYNTAX:", ",".join(syntax_features(sqlite_expr)) or "(none)")
            else:
                print("    SQLITE: (missing)")
            if maria_expr is not None:
                print("    MARIADB:", redact_schema_expression(maria_expr)[:600])
                print("    MARIADB_SYNTAX:", ",".join(syntax_features(maria_expr)) or "(none)")
            else:
                print("    MARIADB: (missing)")
    print("LITERALS_REDACTED: YES; NO ROW DATA EXPORTED.")
    print("HEURISTIC_PAIRS_ONLY: YES; CHECK_SEMANTICS_VERIFIED: NO")
    print("IMPORT_AUTHORIZED: NO; NO NETWORK; NO DATABASE WRITES.")
    return 2 if unresolved else 0


if __name__ == "__main__":
    sys.exit(main())
