# RD CONNECT — Combined Batch 1 + Batch 2, October 2026

**Current status: PARTIAL IMPLEMENTATION / NO-GO. Do not connect the live
PWA or switch DNS, Worker or D1 routing.** The stage-3 release runbook
`RELEASE_RUNBOOK.md` remains applicable and has not been bypassed.

## What Batch 1 actually implements

New internal, authenticated, **read-only** Node/MariaDB service:

- `src/school-read-service.cjs` — token-backed staff vs student/guardian
  identity (reuses `staging-auth-service.me`); authenticated staff can
  list accessible classrooms and their enrollments, see daily attendance,
  and view their own timetable. Historical roster selections use the
  original D1 enrollment interval rule `start_date <= date` and
  `end_date > date` (end date exclusive).
- Staff classroom permissions preserve primary AND second advisor and
  active subject-teaching access. Generic student-affairs `staff`
  accounts have school-wide read-only supervision, but not unlimited
  daily attendance **write** permission.
- Portal accounts may list linked children and see an authorized
  student's daily/period attendance, recorded truancy and late
  arrivals (maximum 90 days per request), plus raw behavior records.
  No query allows a guardian to request an unlinked student.
- `src/staging-school-http.cjs` — **internal** GET-only JSON adapter
  for these seven route-shaped operations, using an injected MariaDB
  connection and Bearer session validation. No CORS or caching.

**This is not complete API parity.** The existing Worker contains
additional workflows and required business-rule side effects. The new
modules are **not imported by `app.js` or `http-handler.cjs`**.
The public Node endpoints deliberately remain 501:
daily/period ATTENDANCE WRITES, multi-student bulk actions,
permanent QR late auto-approval, Push, score adjustment, behavior
incident/restoration, merit, student affairs dashboards and approval
controls, data imports, exports, and settings are NOT exposed.
The original `teacher-timetable.js` additionally requires
`subject_code`, one/two adjacent periods, archived timetable history,
and protection when attendance already exists; older stage-7
generic INSERT/UPDATE/DELETE prototypes are **not a drop-in
replacement** for those D1 business rules.

## Batch 1 continuation — attendance and original timetable parity

The consolidated offline test command also covers these NEW, unexposed
modules:

- `src/attendance-write-contract.cjs`: validates exact complete-room
  attendance payload (1–100 students), advisor 1 or advisor 2
  authorization for **daily** check-in, timetable ownership and
  weekday for **period** check-in, Bangkok date window (today back
  through 14 days), valid statuses, and optional teaching notes.
  Truancy remains a distinct period status; daily absence cannot
  be labeled truancy. The module **refuses all database mutation**
  until the original D1 outbox, behavior score and Push side effects
  are fully ported and tested.
- `src/timetable-d1-parity.cjs`: enforces original Worker teacher
  timetable rules: a required subject code (<=30 chars), subject
  name (<=120), period 1–10 with at most two consecutive periods,
  strict teacher ownership (including student-affairs teaching
  account), and no update/archive after period attendance history
  exists. Archiving preserves the row instead of physically DELETE.
  It is not connected to the previous generic stage-7 lab writer,
  which did **not** have these requirements.
- `src/school-read-service.cjs` now mirrors original semantics for
  GET `/api/attendance?kind=daily`: **only recorded statuses** are
  returned (missing = not yet checked). Room roster with NULL statuses
  remains a separate convenience view. Period GET validates lesson
  owner, room and weekday, reports explicit truancy status, and
  provides read-only daily check-in reference plus optional teaching
  note. Daily GET requires advisor or admin, NOT just any teacher
  with an active timetable in the room.
- `src/staging-school-http.cjs` keeps portal attendance separate
  from staff attendance and is still an **in-process** prototype.
  Passenger returns 501 on ALL unported school routes.
- `test/batch1-attendance-write.test.cjs`,
  `test/batch1-timetable-parity.test.cjs` and added read-service
  regressions are included in `check:batch12`. These are tests of
  deliberately disabled write contracts, NOT proof of working
  real-data check-in or Push.

**No changes are needed to Cloudflare D1 or school MariaDB.**
No student attendance entries were created in this continuation.
A production writer will need an atomic transaction spanning
attendance, audit, truancy score and notification outbox rules;
the SQL trigger parity and notification background processing must
be validated before any public GET or POST routes are enabled.

## Latest continuation — daily attendance atomic MariaDB laboratory

New files:
- `src/lab-daily-attendance-transaction.cjs` — isolated daily writer
  receiving a server-trusted synthetic teacher actor. It re-reads the
  classroom, both advisor positions, and the effective-date enrolled
  student roster **inside the caller's transaction**. It rejects
  incomplete, repeated, cross-room or invalid daily statuses; only
  records `present/absent/late/leave`.
- `scripts/check-lab-daily-attendance-rollback.cjs` — one-command
  MariaDB transaction exercise in isolated `ratsadaa_trgtest`.
  Creates a fake advisor, room, two students, enrollment rows, two
  synthetic timetable slots, two pending-review alerts and two
  distinct notification-outbox events **inside an uncommitted
  transaction**. One event is pending, the other already delivered.
  The writer UPSERTs daily attendance for both fake students and
  resolves pending-review alerts for the absent student, **cancelling
  only pending notifications**. The delivered event stays delivered.
  One `attendance_saved` audit entry is asserted. The script then
  ROLLBACKs the entire transaction and checks that **all 63 tables
  remain empty** and all five triggers remain intact. A second
  synthetic transaction injects a failure after the first student
  update, then ROLLBACKs and again verifies emptiness.
- `test/batch1-lab-daily-attendance.test.cjs` — opt-in guards,
  SQL ordering, two-advisor authorization, exact roster and injected
  failure checks, automatically included in `check:batch12`.

The **real SQL lab** is disabled unless explicitly opted in with a
temporary environment variable. Do not change the existing
`RD_DB_*` staging credentials. The separate
`RD_TRIGGER_LAB_DB_*` credentials must still point only to
`ratsadaa_trgtest`.

To run the real lab once (after refreshing the branch ZIP and
uploading `node-hosting/` to the existing *test* app):
1. Confirm no prior `RD_TRIGGER_LAB_ALLOW_WRITE/DDL/RACE/LOCK/RETRY`
   flags are present.
2. Temporarily set:
   `RD_TRIGGER_LAB_ALLOW_ATTENDANCE=RUN_LAB_DAILY_ATTENDANCE_ROLLBACK_B1`
3. In DirectAdmin Run JS Script, run:
   `check:lab-daily-attendance`
4. Expect `returncode: 0`, `BATCH 1 LAB DAILY OK`,
   `OUTBOX PARITY OK`, `ROLLBACK VERIFIED`,
   `LAB UNCHANGED`.
5. Remove `RD_TRIGGER_LAB_ALLOW_ATTENDANCE` immediately afterward.

On unexpected error, **do not bypass the lab guards**.
Inspect the lab state if the rollback or emptiness confirmation
failed. This file **never COMMITs**, creates no school records
in `ratsadaa_connect`, and does not enable any public HTTP route.
`check:batch12` still does only offline tests when the lab opt-in
is unset.

**Important limitations:** This is the first transactional daily
attendance prototype, not full attendance deployment. No HTTP POST
can call it, no real school user is authenticated through it, no
Push is delivered, and period attendance/truancy scoring plus
behavior warnings/outbox generation are **still blocked** until
full D1-equivalent concurrency and side effects are ported.
The release decision stays **NO-GO**.

## What Batch 2 actually implements

New **private/offline local source exporter**, **dry-run import
planner**, and **read-only reconciliation tools**:

1. `migration/export-d1-sql-to-jsonl.py` — from a **trusted local**
   Wrangler D1 SQL dump, uses Python standard library sqlite3 to
   prepare 63 table-aligned JSONL files, with per-table counts,
   columns, SHA-256 and `manifest.json`. No outbound network
   calls and no data are uploaded.
2. `migration/manifest-planner.cjs` — checks the 63-table manifest,
   safe filenames, optional byte-for-byte JSONL hashes and line counts,
   and target staging columns; computes parent-first FK dependency
   layers. Cycles and incompatible schema are blockers, not ignored.
3. `scripts/check-d1-migration-plan.cjs` — scans only
   `ratsadaa_connect` metadata and checks it contains **63 empty
   tables, 119 foreign keys, 0 triggers**; prepares a source/target
   compatibility plan when `RD_D1_MANIFEST_FILE` is supplied. It
   does NOT import any records.
4. `migration/reconcile.cjs` and
   `scripts/check-d1-reconciliation.cjs` — if a future **approved**
   migration has occurred, read target per-table counts and
   inspect up to 119 FK constraints (including composite keys) for
   orphaned relations. The report contains aggregates only, not
   names or row values; it never changes data. Count/FK parity
   alone **does not** prove a complete or correct migration.
5. `scripts/check-batch12.cjs` — one command for both offline
   API-scope tests and source import planning.

**The actual real-data transfer is NOT implemented/authorized in this
batch.** Before it is safe to enable an importer, we must port and
test the remaining D1 triggers/behaviors, verify row-level type
conversions and historical consistency, design resumable secure
imports on shared hosting, rehearse backup/restore and receive
explicit school approval. DO NOT disable FK constraints or copy
JSONL directly into the live Node environment.

## Upload ONE full Node package

From the existing experimental branch ZIP
`https://github.com/yoottana-cyber/rd-care/archive/refs/heads/plan/node24-mariadb-directadmin.zip`,
open the inner `node-hosting/` folder and upload **its contents**
into the existing isolated stage root:

`/home/ratsadaa/rd-connect-node-stage/`

Maintain the folder structure (`src/`, `scripts/`, `test/`,
`migration/` etc.). You can overwrite the older staged source
files; do NOT upload `.git`, private SQL export files, JSONL,
student rosters, actual passwords or other untracked data.
`.env.example` is a template, not the live `.env`. Do not replace
DirectAdmin's actual secret environment variables.

**One test command:**
`check:batch12` through DirectAdmin → Setup Node.js App →
Run JS Script. Expected when no private D1 export is available:

```text
BATCH 1 OFFLINE OK
BATCH 1 HTTP CLOSED
BATCH 2 PLANNER OK
BATCH 2 SOURCE PENDING
BATCH 1+2 SOURCE/MIGRATION PENDING
```

Expected **returncode 2** because the import source is not yet
provided. This is deliberate, not a test failure and not an
authorization to go live. `returncode 1` means a test or preflight
failed and must be investigated. No test flag is needed.

## Optional future local D1 data-export procedure

**Do NOT perform this step until authorized to handle actual student
and guardian records and a recoverable backup is available.** Use
an authorized Wrangler account to export an existing D1 database as
a local SQL dump, without changing the original database. Treat
the dump as sensitive school data. Keep it off public storage and
out of GitHub, user-facing logs and AI chat uploads.

On a private Windows computer with Python 3 installed:

```powershell
py migration/export-d1-sql-to-jsonl.py --source-sql "C:\\private\\rd-connect-d1.sql" --output "C:\\private\\rd-d1-jsonl" --export-local
```

This tool will refuse an output directory that already exists. It
writes `manifest.json` and one `*.jsonl` per table, without
printing student names, passwords, IDs, attendance or behavior entries.
Protect files with local access controls and encrypt approved backups.
Never commit or upload the JSONL files into a Git repository.

To run the **manifest-only** import planner on DirectAdmin, copy ONLY
`manifest.json` into a private server path controlled by school IT
and configure `RD_D1_MANIFEST_FILE` with that path; the JSONL
content stays on the private school computer until an approved import.
Then run `check:d1-migration-plan` (still NO-GO and no data writes).

Only after an authorized future dry-run import and reconciliation
would `check:d1-reconciliation` meaningfully compare the two DBs.
It also remains NO-GO pending full content and business audits.

## Current release decision

`check:go-live` from Release Pack 3 remains an independent
fail-closed gate and must continue returning NO_GO. Full server
integration, actual migration, complete school business rules,
Push and PWA parity, restored backups and an approved rollback
rehearsal are still required. Nothing in this package modifies
live Cloudflare, D1, school DNS, `ratsadaa_connect` data or
`ratsadaa_trgtest` triggers, and nothing is merged to `main`.
