#!/usr/bin/env python3
"""Offline-only D1 roster upgrade; NEVER run on a live database."""
import argparse
from pathlib import Path
import re
import sqlite3
import sys
import tempfile

OLD = re.compile(r",\s*UNIQUE\s*\(\s*classroom_id\s*,\s*roll_no\s*\)", re.I)
TABLE = re.compile(r"^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?students\b", re.I)
INDEX = "uq_students_current_room_roll"

def check(db):
    if db.execute("PRAGMA foreign_key_check").fetchall():
        raise ValueError("Foreign key violations detected; refusing upgrade")
    if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("Database integrity check failed")

def counts(db):
    names = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return {name:db.execute('SELECT count(*) FROM "'+name+'"').fetchone()[0] for name in names}

def rebuild(db):
    db.commit()
    db.execute("PRAGMA foreign_keys=OFF")
    check(db)
    before = counts(db)
    row = db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='students'").fetchone()
    if not row or not OLD.search(row[0]) or db.execute(
        "SELECT 1 FROM sqlite_master WHERE name=?", (INDEX,)).fetchone():
        raise ValueError("Expected original students room/roll constraint; upgrade may already be applied")
    ddl = TABLE.sub("CREATE TABLE students__replacement", OLD.sub("", row[0], count=1), count=1)
    columns = [r[1] for r in db.execute("PRAGMA table_info(students)")]
    if not {"id","student_no","classroom_id","roll_no","active","deleted_at"} <= set(columns):
        raise ValueError("Unexpected students columns")
    quoted = ",".join('"'+col+'"' for col in columns)
    definitions = [r[0] for r in db.execute(
        "SELECT sql FROM sqlite_master WHERE tbl_name='students' "
        "AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name")]
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute(ddl)
        db.execute("INSERT INTO students__replacement ("+quoted+") SELECT "+quoted+" FROM students")
        db.execute("DROP TABLE students")
        db.execute("ALTER TABLE students__replacement RENAME TO students")
        for sql in definitions:
            db.execute(sql)
        db.execute("CREATE UNIQUE INDEX "+INDEX+
                   " ON students(classroom_id,roll_no) WHERE deleted_at IS NULL")
        db.execute("""
           UPDATE student_enrollments AS h
           SET end_date=CASE WHEN date(s.deleted_at)>h.start_date THEN date(s.deleted_at)
               ELSE date(h.start_date,'+1 day') END
           FROM students AS s WHERE s.id=h.student_id
             AND s.deleted_at IS NOT NULL AND h.end_date IS NULL
        """)
        if counts(db) != before:
            raise ValueError("Table row counts changed")
        check(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.execute("PRAGMA foreign_keys=ON")
    check(db)
    return before

def convert(input_path,output_path):
    if input_path.resolve()==output_path.resolve() or output_path.exists():
        raise ValueError("Output must be new and distinct from input")
    data=input_path.read_text(encoding="utf-8-sig")
    if "_cf_KV" in data:
        raise ValueError("Internal D1 table detected; export without _cf_KV")
    with tempfile.TemporaryDirectory(prefix="rd-roster-copy-") as folder:
        db=sqlite3.connect(str(Path(folder)/"work.sqlite3"))
        try:
            db.execute("PRAGMA foreign_keys=OFF")
            db.executescript(data)
            before=rebuild(db)
            dump=[line for line in db.iterdump() if line not in ("BEGIN TRANSACTION;","COMMIT;")]
            output_path.write_text("PRAGMA defer_foreign_keys=ON;\n"+"\n".join(dump)+
                                   "\nPRAGMA foreign_key_check;\n",encoding="utf-8")
        finally:
            db.close()
    return before

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Upgrade an exported SQL copy to identity-keyed roster")
    parser.add_argument("--input",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    try:
        result=convert(args.input,args.output)
        print("Validation passed. Preserved rows:",result)
        print("Import output into NEW D1 database only, not the production database.")
    except Exception as exc:
        print("Upgrade refused:",exc,file=sys.stderr)
        sys.exit(1)
