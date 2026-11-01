#!/usr/bin/env python3
"""OFFLINE CHECK text audit. Not proof of MariaDB semantic equivalence."""
import argparse
import collections
import csv
import importlib.util
import re
import sqlite3
import sys
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "rd_constraints", Path(__file__).resolve().parent/"audit-mariadb-constraints.py")
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)


def skip_quote(sql, i):
    n = len(sql)
    ch = sql[i]
    if ch == "-" and i+1 < n and sql[i+1] == "-":
        end = sql.find("\n", i+2)
        return n if end == -1 else end+1
    if ch == "/" and i+1 < n and sql[i+1] == "*":
        end = sql.find("*/", i+2)
        if end == -1:
            raise ValueError("unterminated_comment")
        return end+2
    if ch == "[":
        end = sql.find("]", i+1)
        if end == -1:
            raise ValueError("unterminated_identifier")
        return end+1
    if ch not in ("'", '"', chr(96)):
        return i
    p = i+1
    while p < n:
        if sql[p] == ch:
            if p+1 < n and sql[p+1] == ch:
                p += 2
                continue
            return p+1
        p += 1
    raise ValueError("unterminated_quoted_value")


def closing_paren(sql, start):
    if start >= len(sql) or sql[start] != "(":
        raise ValueError("missing_open_paren")
    depth = 0
    i = start
    while i < len(sql):
        end_quote = skip_quote(sql, i)
        if end_quote != i:
            i = end_quote
            continue
        if sql[i] == "(":
            depth += 1
        if sql[i] == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("unbalanced_parens")


def sqlite_check_bodies(ddl):
    result = []
    i = 0
    while i < len(ddl):
        q = skip_quote(ddl, i)
        if q != i:
            i = q
            continue
        token = re.match(r"CHECK\b", ddl[i:], re.I)
        if token and (i == 0 or not (ddl[i-1].isalnum() or ddl[i-1] == "_")):
            pos = i+token.end()
            while pos < len(ddl) and ddl[pos].isspace():
                pos += 1
            if pos < len(ddl) and ddl[pos] == "(":
                end = closing_paren(ddl, pos)
                result.append(ddl[pos+1:end])
                i = end+1
                continue
        i += 1
    return result


def canonical(expr):
    """Conservative textual normalization; never proves SQL equivalence."""
    raw = expr.strip()
    while raw.startswith("(") and closing_paren(raw, 0) == len(raw)-1:
        raw = raw[1:-1].strip()
    chars = []
    i = 0
    while i < len(raw):
        quote_end = skip_quote(raw, i)
        if quote_end != i:
            ch = raw[i]
            if ch in (chr(96), "["):
                chars.append(raw[i+1:quote_end-1].lower())
            elif ch in ("'", '"'):
                chars.append(raw[i:quote_end])
            else:
                chars.append(" ")
            i = quote_end
        else:
            if not raw[i].isspace():
                chars.append(raw[i].lower())
            i += 1
    return "".join(chars)


def compare(tables, target):
    source = {name: [canonical(x) for x in sqlite_check_bodies(ddl or "")]
              for name, ddl in tables if name != "school_schema_migrations"}
    destination = collections.defaultdict(list)
    for table, cname, clause in target["CHECK"]:
        if table == "d1_migrations":
            continue
        if table not in source or not clause.strip():
            raise ValueError("unexpected_check_table_or_empty_clause")
        destination[table].append(canonical(clause))
    exact = 0
    count_discrepancies = []
    unmatched_tables = []
    for name in sorted(source):
        src = collections.Counter(source[name])
        dst = collections.Counter(destination[name])
        exact += sum((src & dst).values())
        if sum(src.values()) != sum(dst.values()):
            count_discrepancies.append((name, sum(src.values()), sum(dst.values())))
        left, right = sum((src-dst).values()), sum((dst-src).values())
        if left or right:
            unmatched_tables.append((name, left, right))
    return {
        "source_count": sum(map(len, source.values())),
        "dest_count": sum(map(len, destination.values())),
        "matched_text": exact,
        "different_counts": count_discrepancies,
        "review": unmatched_tables,
    }


def main():
    parser = argparse.ArgumentParser(description="Offline CHECK text-only parity")
    parser.add_argument("backup_file")
    parser.add_argument("sqlite_schema_json")
    parser.add_argument("mariadb_constraints_csv")
    args = parser.parse_args()
    try:
        tables, unused = base.read_source(args.backup_file, args.sqlite_schema_json)
        target = base.read_target(args.mariadb_constraints_csv)
        result = compare(tables, target)
    except (ValueError, OSError, KeyError, TypeError, UnicodeError,
            sqlite3.Error, csv.Error):
        print("CHECK PARITY AUDIT BLOCKED: metadata or backup invalid.",
              file=sys.stderr)
        return 1
    print("RD CONNECT SQLITE/MARIADB CHECK TEXT AUDIT: READ ONLY")
    print("SQLITE_CHECKS:", result["source_count"])
    print("MARIADB_CHECKS:", result["dest_count"])
    print("EXACT_NORMALIZED_TEXT_MATCHES:", result["matched_text"])
    print("PER_TABLE_COUNT_MISMATCHES:", len(result["different_counts"]))
    for name, a, b in result["different_counts"][:30]:
        print(" -", name, "SQLITE="+str(a), "MARIADB="+str(b))
    print("CHECK_EXPRESSION_TABLES_REQUIRING_REVIEW:", len(result["review"]))
    print("UNMATCHED_SQLITE_CHECKS:", result["source_count"] - result["matched_text"])
    print("UNMATCHED_MARIADB_CHECKS:", result["dest_count"] - result["matched_text"])
    for name, a, b in result["review"][:35]:
        print(" -", name, "SQLITE="+str(a), "MARIADB="+str(b))
    print("CHECK_SEMANTICS_VERIFIED: NO | IMPORT_AUTHORIZED: NO")
    print("Even matching text does NOT establish collation, NULL or coercion behavior.")
    print("NO DATA VALUES EXPORTED; NO NETWORK; NO DATABASE WRITES.")
    return 2 if result["different_counts"] or result["review"] else 0


if __name__ == "__main__":
    sys.exit(main())
