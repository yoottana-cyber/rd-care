#!/usr/bin/env python3
"""Direct D1 roster import (CSV UTF-8), bypassing Pages Service Binding / Worker.
Default is preview only. All data stays on the administrator's computer/D1.
Requires local Node.js, npm-installed Wrangler and Cloudflare login.
Never accepts or modifies portal passwords or guardian accounts.
"""
import argparse
import csv
import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker"
PRIVATE = ROOT / "private-data" / "direct-roster-import"
VALID_COLUMNS = {"classroom", "student_no", "roll_no", "full_name"}
BAD = re.compile(r"[\x00-\x1f\x7f]")

def safe_literal(value):
    """Quote SQLite string values; always escape apostrophes."""
    value = str(value)
    if BAD.search(value):
        raise ValueError("unsupported control character")
    return "'" + value.replace("'", "''") + "'"

def read_csv(path, encoding):
    if path.suffix.lower() != ".csv":
        raise ValueError("Save Excel as CSV UTF-8 (.csv); do not provide passwords in this file")
    try:
        with path.open("r", encoding=encoding, newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or not VALID_COLUMNS.issubset(
                {str(x).strip().lower() for x in reader.fieldnames}):
                raise ValueError("Required columns: classroom,roll_no,student_no,full_name")
            rows = []
            for index, raw in enumerate(reader, 2):
                normalized = {str(k).strip().lower(): str(v or "").strip()
                              for k, v in raw.items() if k is not None}
                rows.append({"source_row": index,
                    **{k: normalized.get(k, "") for k in VALID_COLUMNS}})
            return rows
    except UnicodeError:
        raise ValueError("Cannot read Thai characters; save as CSV UTF-8 or use --encoding cp874")

def wrangler(database, sql=None, file=None, export=None):
    if sum(v is not None for v in (sql, file, export)) != 1:
        raise ValueError("choose one Wrangler operation")
    if export:
        cmd = ["npx", "--no-install", "wrangler", "d1", "export",
               database, "--remote", "--skip-confirmation", "--output", str(export)]
    else:
        cmd = ["npx", "--no-install", "wrangler", "d1", "execute",
               database, "--remote", "--json", "--yes"]
        cmd += ["--command", sql] if sql is not None else ["--file", str(file)]
    try:
        result = subprocess.run(cmd, cwd=WORKER, capture_output=True,
                                text=True, encoding="utf-8", timeout=180, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        raise RuntimeError("Wrangler not installed, not logged in, or timed out") from e
    if result.returncode:
        # Never echo SQL or rows in terminal output (may contain student PII).
        raise RuntimeError("Wrangler D1 command failed. Check Cloudflare authentication, D1 name, permissions, and private Logs")
    if export:
        return None
    try:
        payload = json.loads(result.stdout)
        if not isinstance(payload, list):
            raise ValueError("Unexpected Wrangler JSON format")
        return [row for part in payload for row in part.get("results", [])]
    except (ValueError, TypeError, KeyError) as e:
        raise RuntimeError("Wrangler returned an unexpected JSON response") from e

def get_snapshot(database):
    rooms = wrangler(database, sql="SELECT id,label FROM classrooms")
    students = wrangler(database, sql=(
        "SELECT id,student_no,classroom_id,roll_no,full_name,active,deleted_at FROM students"))
    enroll = wrangler(database, sql=(
        "SELECT student_id,classroom_id,roll_no FROM student_enrollments WHERE end_date IS NULL"))
    return rooms, students, enroll

def plan_rows(rows, snapshot):
    rooms, students, enrollments = snapshot
    room_map = {str(r["label"]): int(r["id"]) for r in rooms}
    student_map = {}
    room_roll_map = {}
    for student in students:
        k = str(student["student_no"]).casefold()
        student_map.setdefault(k, []).append(student)
        room_roll_map[(int(student["classroom_id"]), int(student["roll_no"]))] = student
    enroll_map = {}
    enroll_roll_map = {}
    for e in enrollments:
        enroll_map[int(e["student_id"])] = e
        enroll_roll_map[(int(e["classroom_id"]), int(e["roll_no"]))] = e
    used_student, used_roll, output = set(), set(), []
    for row in rows:
        original = str(row.get("student_no", "")).strip()
        label = str(row.get("classroom", "")).strip()
        name = str(row.get("full_name", "")).strip()
        value = row.get("roll_no", "")
        key = original.casefold()
        room_id = room_map.get(label)
        reason = ""
        if not original or len(original) > 40 or BAD.search(original):
            reason = "invalid student number"
        elif not name or len(name) > 120 or BAD.search(name):
            reason = "invalid student name"
        elif not room_id:
            reason = "classroom label missing from D1"
        try:
            roll = int(value)
            if str(value).strip() != str(roll) or roll < 1 or roll > 100:
                raise ValueError()
        except (TypeError, ValueError):
            roll = None
            reason = reason or "invalid roll number (1–100)"
        existing = student_map.get(key, [])
        current = existing[0] if len(existing) == 1 else None
        if len(existing) > 1:
            reason = reason or "ambiguous duplicate student number in database"
        if key in used_student:
            reason = reason or "duplicate student number in CSV"
        if room_id is not None and roll is not None and (room_id, roll) in used_roll:
            reason = reason or "duplicate classroom roll in CSV"
        if current:
            sid = int(current["id"])
            if current.get("deleted_at") or int(current.get("active", 1)) != 1:
                reason = reason or "student is archived or inactive"
            elif int(current["classroom_id"]) != room_id:
                reason = reason or "student belongs to another classroom; use transfer menu"
            enrollment = enroll_map.get(sid)
            if (not enrollment or int(enrollment["classroom_id"]) != room_id or
                int(enrollment["roll_no"]) != int(current["roll_no"])):
                reason = reason or "current enrollment is missing or inconsistent; check manually"
        if room_id is not None and roll is not None:
            occupied = room_roll_map.get((room_id, roll))
            if occupied and (not current or int(occupied["id"]) != int(current["id"])):
                reason = reason or "roll number is already assigned to another student"
            occupied_enrollment = enroll_roll_map.get((room_id, roll))
            if occupied_enrollment and (not current or int(occupied_enrollment["student_id"]) != int(current["id"])):
                reason = reason or "roll number is already assigned in current enrollment"
        kind = "skip" if reason else ("update" if current else "add")
        output.append({**row, "classroom_id": room_id, "roll_no": roll,
                       "existing_id": int(current["id"]) if current else None,
                       "action": kind, "reason": reason})
        if not reason:
            used_student.add(key)
            used_roll.add((room_id, roll))
    return output

def row_sql(row, actor_id, today):
    if row["action"] == "skip":
        return []
    name = safe_literal(row["full_name"])
    number = safe_literal(row["student_no"])
    room = int(row["classroom_id"])
    roll = int(row["roll_no"])
    actor = int(actor_id)
    if row["action"] == "update":
        sid = int(row["existing_id"])
        return [
            f"""UPDATE OR IGNORE students SET full_name={name},roll_no={roll}
              WHERE id={sid} AND classroom_id={room} AND active=1 AND deleted_at IS NULL
              AND NOT EXISTS(SELECT 1 FROM students WHERE classroom_id={room}
                AND roll_no={roll} AND id<>{sid})
              AND NOT EXISTS(SELECT 1 FROM student_enrollments
                WHERE classroom_id={room} AND roll_no={roll} AND end_date IS NULL
                AND student_id<>{sid})""",
            f"""UPDATE OR IGNORE student_enrollments SET roll_no={roll}
               WHERE student_id={sid} AND classroom_id={room} AND end_date IS NULL
                 AND (SELECT roll_no FROM students WHERE id={sid})={roll}"""
        ]
    if row["action"] == "add":
        day = safe_literal(today)
        return [
            f"""INSERT OR IGNORE INTO students(student_no,classroom_id,roll_no,full_name,active)
              SELECT {number},{room},{roll},{name},1
              WHERE NOT EXISTS(SELECT 1 FROM students WHERE lower(student_no)=lower({number}))
                AND NOT EXISTS(SELECT 1 FROM students WHERE classroom_id={room} AND roll_no={roll})
                AND NOT EXISTS(SELECT 1 FROM student_enrollments WHERE classroom_id={room}
                  AND roll_no={roll} AND end_date IS NULL)""",
            f"""INSERT OR IGNORE INTO student_enrollments(student_id,classroom_id,roll_no,start_date,changed_by)
              SELECT id,{room},{roll},{day},{actor} FROM students
              WHERE lower(student_no)=lower({number}) AND classroom_id={room}
                AND roll_no={roll} AND active=1 AND deleted_at IS NULL
                AND NOT EXISTS(SELECT 1 FROM student_enrollments
                  WHERE student_id=students.id)"""
        ]
    return []

def verified(database, group):
    keys = list({str(x["student_no"]).casefold() for x in group})
    if not keys:
        return {}
    quoted = ",".join(safe_literal(k) for k in keys)
    sql = f"""SELECT s.student_no,s.classroom_id,s.roll_no,s.full_name,
             e.classroom_id AS enrollment_room,e.roll_no AS enrollment_roll
             FROM students s LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.end_date IS NULL
             WHERE lower(s.student_no) IN ({quoted})"""
    return {str(row["student_no"]).casefold(): row for row in wrangler(database, sql=sql)}

def write_report(rows, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        columns = ["source_row","student_no","classroom","roll_no","action","result","reason"]
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for r in rows:
            writer.writerow({column: r.get(column, "") for column in columns})
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass

def execute_plan(database, rows, actor_id, batch_size, backup):
    PRIVATE.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = PRIVATE / f"rd-care-d1-backup-{stamp}.sql"
    print("Creating private D1 backup before writing...")
    wrangler(database, export=backup_path)
    print("Backup created:", backup_path)
    planned = [r for r in rows if r["action"] in ("add","update")]
    today = datetime.datetime.now(ZoneInfo("Asia/Bangkok")).date().isoformat()
    confirmed = 0
    for start in range(0, len(planned), batch_size):
        group = planned[start:start+batch_size]
        statements = [stmt for r in group for stmt in row_sql(r,actor_id,today)]
        handle = tempfile.NamedTemporaryFile(mode="w",suffix=".private.sql",
            dir=PRIVATE,encoding="utf-8",delete=False)
        sql_path = Path(handle.name)
        try:
            with handle:
                handle.write(";\n".join(statements)+";\n")
            try:
                os.chmod(sql_path, 0o600)
            except OSError:
                pass
            wrangler(database,file=sql_path)
            lookup=verified(database,group)
            for entry in group:
                actual=lookup.get(entry["student_no"].casefold())
                okay=bool(actual and
                    actual["full_name"] == entry["full_name"] and
                    int(actual["classroom_id"]) == entry["classroom_id"] and
                    int(actual["roll_no"]) == entry["roll_no"] and
                    actual["enrollment_room"] is not None and
                    int(actual["enrollment_room"]) == entry["classroom_id"] and
                    int(actual["enrollment_roll"]) == entry["roll_no"])
                entry["result"]="verified" if okay else "needs_review"
                if not okay:
                    entry["reason"]="D1 row did not match expected identity and enrollment; inspect before rerunning"
                confirmed+=int(okay)
        except Exception:
            for entry in group:
                if not entry.get("result"):
                    entry["result"]="unknown"
                    entry["reason"]="Wrangler batch stopped; verify D1 before reapplying"
            raise
        finally:
            sql_path.unlink(missing_ok=True)
            write_report(rows,PRIVATE/"last-import-report.csv")
        if (start//batch_size+1)%5==0 or start+batch_size>=len(planned):
            print(f"Verified {confirmed} / {min(start+batch_size,len(planned))} requested rows")
    return confirmed

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file",type=Path,help="CSV UTF-8 export from Excel")
    parser.add_argument("--encoding",default="utf-8-sig",choices=["utf-8-sig","utf-8","cp874"])
    parser.add_argument("--database",default="rd-care-dev")
    parser.add_argument("--apply",action="store_true",help="WRITE to REMOTE D1; default preview only")
    parser.add_argument("--confirm",default="",help='Must be "APPLY" for remote writes')
    parser.add_argument("--actor-id",type=int,help="ID of school admin in D1, required for --apply")
    parser.add_argument("--batch-size",type=int,default=12)
    args=parser.parse_args(argv)
    if not args.file.is_file():
        parser.error("CSV file not found")
    if args.batch_size<1 or args.batch_size>25:
        parser.error("batch-size must be 1–25")
    if args.apply and (args.confirm!="APPLY" or not args.actor_id or args.actor_id<1):
        parser.error('Remote writes require --apply --confirm APPLY --actor-id <admin_id>')
    try:
        rows=read_csv(args.file,args.encoding)
        if not rows:
            raise ValueError("CSV contains no student rows")
        if args.apply:
            actors=wrangler(args.database,sql=f"SELECT role FROM users WHERE id={args.actor_id}")
            if not actors or actors[0]["role"]!="admin":
                raise ValueError("--actor-id must identify an existing admin user")
        snapshot=get_snapshot(args.database)
        planned=plan_rows(rows,snapshot)
        for row in planned:
            row["result"]="skipped" if row["action"]=="skip" else "pending"
        PRIVATE.mkdir(parents=True, exist_ok=True)
        report=PRIVATE/"last-import-report.csv"
        write_report(planned,report)
        counts={status:sum(x["action"]==status for x in planned) for status in ("add","update","skip")}
        print(f"Rows: {len(planned)} | Add: {counts['add']} | Update: {counts['update']} | Skip: {counts['skip']}")
        print("Detailed report saved locally:",report)
        if not args.apply:
            print("PREVIEW ONLY. No data changed. Confirm classroom labels/room rolls before --apply.")
            return 0
        verified_count=execute_plan(args.database,planned,args.actor_id,args.batch_size,report)
        print(f"Completed and verified {verified_count} rows; review any needs_review in {report}")
        return 0
    except (RuntimeError, ValueError, OSError) as error:
        print("STOPPED:",str(error),file=sys.stderr)
        print("Any successful groups remain in D1. Keep the private backup/report and re-run only after review.",file=sys.stderr)
        return 1

if __name__=="__main__":
    sys.exit(main())
