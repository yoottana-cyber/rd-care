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

## Batch 1 continuation — Period attendance, truancy score lifecycle and outbox (rollback-only)

Stage daily-transaction `check:lab-daily-attendance` was confirmed on
the separate MariaDB lab: synthetic two-student daily attendance,
pending-only review cancellation, delivered event preserved, two
ROLLBACKs, all 63 tables empty and the same five triggers.

The next consolidated update adds:
- `src/lab-period-attendance-transaction.cjs`: MariaDB SQL for an
  **unexposed, disposable LAB ONLY** period check-in transaction.
  Validates the timetable owner, active lesson, date/weekday and
  exact historical enrollment roster. It stores 'truancy' in
  `attendance_period` as 'absent' with a separate
  `period_truancy` classification, preserves one
  `truancy_events` record, and uses the exact configured
  `truancy_score_policy` / `affairs_behavior_rules` negative
  points (never assumes -10).
- Linked misconduct score behavior: first truancy creates one
  `behavior_records` plus `truancy_behavior_links`;
  re-submitting the same truancy does not create a second score;
  correction soft-deletes the original score; reclassification
  restores that **same ID**, not a duplicate. **Good deed points
  are not offset or modified.**
- Ordinary period absence queues an advisor review only where
  the student's daily attendance does not already show 'absent'.
  Cancel only PENDING notifications when status is corrected.
  Keep DELIVERED audit history unchanged. Teaching notes and
  attendance audit records are part of the same transaction.
- `scripts/check-lab-period-truancy-rollback.cjs`: exercise a
  **synthetic configurable -7 policy** and two students through
  truancy, resubmission, correction, restoration, ordinary absence,
  pending review, delivered-vs-pending cancellation, and note
  clearing. Repeat with an injected error. Both cases **always
  ROLLBACK and check every table is empty**. No COMMIT or Push
  delivery occurs. Exactly five previously verified lab triggers
  must remain unchanged.
- `test/batch1-lab-period.test.cjs` is also included in
  `check:batch12` offline tests.

### One DirectAdmin integration test (no actual school data)

After downloading the latest experimental ZIP, upload the complete
contents of `node-hosting/` to the existing isolated DirectAdmin
`/home/ratsadaa/rd-connect-node-stage/` application. Do not
change `RD_DB_*` staging settings.

1. Confirm `RD_TRIGGER_LAB_ALLOW_ATTENDANCE` and older
   `RD_TRIGGER_LAB_ALLOW_*` test opt-ins are REMOVED.
2. In DirectAdmin → Setup Node.js App → Environment Variables
   temporarily add:
   `RD_TRIGGER_LAB_ALLOW_PERIOD=RUN_LAB_PERIOD_TRUANCY_ROLLBACK_B1`
3. Via Run JS Script run: `check:lab-period-truancy`.
4. Expected **returncode 0**, lines:
   `BATCH 1 LAB PERIOD OK`, `SCORE LIFECYCLE OK`,
   `OUTBOX OK`, `ROLLBACK VERIFIED`, and `LAB UNCHANGED`.
   No data should be committed and all 63 tables must remain
   empty with five original triggers.
5. Immediately REMOVE `RD_TRIGGER_LAB_ALLOW_PERIOD`.
   If error or `LAB UNCHANGED` is missing, **do not blindly
   retry**; inspect the lab emptiness/transaction state.

This check is NOT proof of concurrency-safe production operation.
Only the five guardian/timetable triggers exist in this lab;
the full D1 behavior trigger suite is NOT installed there.
This isolated writer implements its own linked scoring behavior
for synthetic exercises. Its SQL must still be validated against
the actual MariaDB schema and compared with the original Worker
semantics before enabling production. No public auth/login,
student/parent endpoints, period writes, QR, behavior writes or
Web Push are enabled by this update. **GO-LIVE remains NO-GO.**

## Batch 1 continuation — Safe OFFLINE truancy Push eligibility

**Lab period/truancy SQL passed on isolated MariaDB:** two synthetic
students, configurable -7 points, single linked behavior record,
correction soft-delete and same-ID restoration; pending-only outbox
cancellation; both complete-lifecycle and injected-error transactions
ROLLBACK; 63 tables empty and five triggers unchanged.

The latest branch adds **OFFLINE ONLY** notification eligibility, not
delivery infrastructure:

- `src/truancy-push-offline-plan.cjs` validates a trusted, previously
  COMMITTED, still-active and recent truancy event before considering
  outbound Push. It refuses corrected/dismissed events, stale events,
  incomplete recipient identity, dates outside the 14-day attendance
  window, or missing VAPID readiness.
- It separately verifies primary/secondary homeroom advisors,
  **verified** guardian links, active parent/student portal accounts,
  and student identity. It honors each admin-managed
  `truancy_advisor`, `truancy_guardian` and `truancy_student`
  notification category.
- Eligibility is keyed by
  `event_id:generation:recipient_type:subscription_id`.
  A delivered record may never be sent again. Maximum **3**
  attempts, minimum **2-minute** cooldown for recently failed
  or abandoned `sending` entries. A corrected-and-reclassified
  event may use a new generation. Duplicate subscriber rows are
  suppressed. Output never contains Web Push endpoints, secret keys,
  student names, student numbers or medical/behavior details.
- `test/batch1-truancy-push-offline.test.cjs` validates ten
  no-network synthetic cases. The same tests are now included
  in `check:batch12` and available independently as
  `check:push-offline`.
- `scripts/check-push-offline.cjs` also verifies the existing
  Passenger handler returns **501 endpoint_not_migrated** for
  unported attendance/Push routes. This is intentional; no endpoint
  is enabled by adding files.

### Run the next single DirectAdmin check

Upload the fresh **complete contents** of `node-hosting/` from
the experimental ZIP to
`/home/ratsadaa/rd-connect-node-stage/` without changing
secret DirectAdmin settings.

Ensure old `RD_TRIGGER_LAB_ALLOW_PERIOD` and other temporary
write flags are **removed**. No environment flag, VAPID setting,
database connection or student/guardian export is needed.

DirectAdmin → Setup Node.js App → Run JS Script:
`check:push-offline`.

Expected **returncode 0** with:
- `PUSH OFFLINE OK`
- `DEDUPLICATION OK`
- `SAFETY OK`
- `PUBLIC API CLOSED`
- `NO DB ACCESS OR PUSH`
- `NOT PRODUCTION READY`

Even when the offline test passes, **real Web Push remains
UNIMPLEMENTED on the Node backend**: durable MariaDB delivery
upserts/atomic claims, token-verified subscriptions, genuine VAPID
cryptography, scheduling, device removal on 404/410 and provider
response handling must be independently built and tested.
This command does NOT call a Push provider or connect to D1/MariaDB,
so it cannot verify actual browser delivery. GO-LIVE is still
NO-GO; Cloudflare D1 and the original PWA remain untouched.

## Batch 1 continuation — REAL MariaDB Push queue/claim lab (NEVER sends Push)

The last `check:push-offline` completed on DirectAdmin with
`returncode: 0`, all ten synthetic notification tests passing,
and seven public Push/attendance routes still returning 501.

This batch adds:
- `src/lab-truancy-push-queue.cjs`: transaction-only MariaDB queue
  for **two possible classroom advisors**, verified guardian links,
  and authenticated student portal accounts. Recipient lookup is
  performed from current DB relationships; it does not accept any
  device endpoint from a client. Requires a current active
  `truancy_events` row with an actual `period_truancy` record
  and `attendance_period.status='absent'`, within 14 Bangkok
  calendar days. Event generations are preserved separately.
- Queue inserts are idempotent `INSERT IGNORE ... SELECT` under the
  schema's unique keys. Admin `notification_preferences` for
  `truancy_advisor`, `truancy_guardian`,
  `truancy_student` control each audience separately.
- `claim` is an atomic conditional SQL UPDATE of the correct
  delivery table, with **at most 3 attempts**, a **2-minute**
  stale-retry cooldown, a current event/status check and a
  **fresh verification of the advisor/guardian/student link**.
  Claims are blocked for recipients revoked after an event queued
  or a notification category disabled by an administrator.
- Neither queue nor claim contacts VAPID/Push providers, uses
  live subscriptions, sends Web Push or marks a delivery
  `delivered`. The synthetic lab script is permitted to
  simulate a provider acceptance to confirm that already
  accepted events cannot be reclaimed; that row is ROLLED BACK.
- `scripts/check-lab-push-queue-rollback.cjs`: a real MariaDB
  diagnostic with synthetic users, classroom, student, guardian,
  subscriptions, event and notification preferences. Exercises
  four devices (2 advisors, 1 guardian, 1 student), queues
  idempotently, checks duplicate claims, category disable,
  revoked guardian link, failed/cooldown attempt count,
  reclassified truancy generation and a deliberate error.
  **Every transaction is ROLLED BACK**, never COMMIT.
  All **63 lab tables** must be empty and **5 triggers** intact.
- `test/batch1-lab-push-queue.test.cjs`: offline opt-in,
  recipient SQL, idempotence, conditional claim and no-network
  tests, included in `check:batch12`.
- Release Pack 3 now also refuses the temporary
  `RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE` flag (as well as previous
  daily and period opt-ins) during production readiness checks.

### DirectAdmin: one new temporary lab test

1. Download the latest ZIP from the experimental branch and
   upload the contents of `node-hosting/` to
   `/home/ratsadaa/rd-connect-node-stage/`. Keep
   `RD_DB_*` and `RD_TRIGGER_LAB_DB_*` credentials unchanged.
2. REMOVE all prior one-time `RD_TRIGGER_LAB_ALLOW_*` test
   variables, especially `RD_TRIGGER_LAB_ALLOW_PERIOD`.
3. Temporarily create ONE Environment Variable:
   `RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE=RUN_LAB_PUSH_QUEUE_ROLLBACK_B1`
4. DirectAdmin → Setup Node.js App → Run JS Script:
   **`check:lab-push-queue`**.
5. Expected **returncode: 0**, with:
   `PUSH QUEUE LAB OK`, `CLAIM AND DEDUPE OK`,
   `SAFETY OK`, `REACTIVATION OK`,
   `ROLLBACK VERIFIED` and `LAB UNCHANGED`.
6. **Immediately REMOVE** `RD_TRIGGER_LAB_ALLOW_PUSH_QUEUE`.
   If a test fails or `LAB UNCHANGED` does not appear,
   inspect the lab's table inventory and transaction state
   **before any rerun**; do not bypass environment guards.

This test uses `ratsadaa_trgtest` only. It does not install
triggers or create durable data. The Node public API remains
closed; school Cloudflare Worker + D1 is untouched.

**Still NO-GO for production:** the test does NOT prove multi-
connection race safety, real subscription authentication, VAPID
sender crypto, browser support, 404/410 subscription removal,
worker/cron retry scheduling, transport-layer receipts or
record-level migration parity. Actual delivery can be marked
successfully ONLY after a verified Web Push response and commit
on an authorized, fully integrated production writer.

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
