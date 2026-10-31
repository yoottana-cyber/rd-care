# RD CONNECT — Release Pack 3 / Pre-launch & Rollback Runbook

**Status on 30 October 2026: NO-GO.**

This is an operational safety checklist and automated *read-only* preflight
for the proposed Cloudflare D1 → MariaDB / Node.js migration. It is **not
permission to launch**. The standalone Node app currently returns
`/api/health` **503 migration_not_ready** and unported API endpoints
**501 endpoint_not_migrated**. It must not receive school users' actual
attendance/behavior/guardian data.

## Boundaries

- **Existing RD CONNECT** (school PWA and Cloudflare Worker + D1) remains
  the source of truth until an approved switch; retain its routing, keys
  and working public URL unchanged.
- **Isolated Node test:** `/home/ratsadaa/rd-connect-node-stage/`,
  `https://ratsada.ac.th/web/rd-connect-node-test/`, MariaDB staging
  `ratsadaa_connect`. The staging database has the schema only
  (63 tables, 119 foreign keys, 0 production triggers), not the school
  roster.
- **Trigger laboratory:** separate `ratsadaa_trgtest`, 63 empty tables,
  five *test* triggers (three guardian, two timetable); credentials
  must be distinct. Do not move lab triggers blindly into staging.
- **Experimental branch only:**
  `plan/node24-mariadb-directadmin`. Do not merge into `main` or
  change live routing without an explicit release decision.
- Neither this document nor the scripts automatically perform schema
  changes, database writes, import, DNS changes, URL rewrites, push
  configuration, server restarts or traffic switch.

## One-command pre-launch inventory (safe now)

From `node-hosting/` upload:
`package.json`,
`src/release-readiness.cjs`,
`scripts/check-go-live-readiness.cjs`.

Use DirectAdmin → Setup Node.js App → **Run JS Script**:
`check:go-live`.

The command (a) verifies the target database is **only**
`ratsadaa_connect`; (b) refuses any lingering
`RD_TRIGGER_LAB_ALLOW_*` install/write/test flags; (c) checks
API/health routes in-process remain fail-closed; (d) SELECTs
`information_schema` and `SELECT 1 LIMIT 1` on **all 63 staging
tables** to check the known empty baseline; (e) lists missing functional
release gates. No production data, hashes or SQL errors are printed.

**Expected CURRENT result: `returncode: 2` and
`RELEASE READINESS NO_GO`.** Exit code 2 means the current
migration is correctly *blocked*, not that the staging schema is broken.
Exit code 1 means the preflight could not establish the safe
baseline. Exit code 0 is intentionally unavailable while release
requirements remain unfinished. Do not modify the exit code or bypass
the blockers merely to show green output.

## Release GO/NO-GO gates (all must be independently verified)

- [ ] **API parity**: all teacher/student/guardian/admin/student-affairs
  flows implemented behind private auth; independently test daily and
  period attendance, timetables, QR late arrival/auto-approval,
  truancy rules, behavior points, good deeds, reporting and imports.
- [ ] **Guardian and homeroom model**: multiple advisors per classroom,
  separate portal credentials and parent relationships tested with
  enrollment changes; student-affairs teachers retain their classroom
  and teaching permissions without inappropriate access to other rooms.
- [ ] **Push & PWA**: valid permanent VAPID config, test each user
  role's subscription/revocation, late/absence/truancy notification,
  duplicate suppression, deep links, mobile offline/online resume and
  session persistence. Test on supported mobile browsers.
- [ ] **Business rules**: D1 trigger-equivalent operations ported and
  tested, including behavior penalties/restoration and notifications,
  not just guardian/timetable. All data writers including bulk changes
  use consistent concurrency controls and have bounded, safe retries.
- [ ] **Security**: password compatibility and upgrading, rate limits,
  auth/session invalidation, owner-scoped row access, permission matrix,
  HTTPS/secure cookies or bearer policy, CSRF/origin as applicable,
  no secret exposure in logs/errors, upload/CSV validation.
- [ ] **Migration plan**: reproducible D1 export (with authorized
  access) and MariaDB import, foreign keys, history, sessions and
  push subscriptions explicitly included/excluded. Reconcile row
  counts and referential integrity, samples/aggregate reports by
  class, attendance date, behavior and guardian links. Never compare
  personal data through public logs.
- [ ] **Performance**: simulate school peak check-in traffic, burst
  Push and CSV imports on the actual hosting plan; verify 5xx rate,
  response time, DB connection pool capacity and shared-hosting limits.
- [ ] **Backups**: encrypted/access-controlled, dated backups of
  original D1 and the target MariaDB; perform a **RESTORE into separate
  disposable infrastructure**, verify content and record recovery
  point/time. Do not consider merely creating a backup sufficient.
- [ ] **Operational monitoring**: sanitized logs, alerting for 5xx,
  database saturation, failed Push, import errors and missing daily
  check-ins; named release operator and rollback approver.
- [ ] **User acceptance**: representative teachers, student affairs,
  students, guardians and the school IT lead approve sample workflows
  using test users. Record known deviations and explicit decision.

## Dry-run phase (no impact on live)

1. Tag or commit the original PWA/Worker versions and save a
   reversible deploy package. Inventory current VAPID keys, domains
   and settings **without printing secrets**.
2. Restore sanitized copies of the required data into disposable
   migration test infrastructure, never into the trigger lab.
3. Migrate and reconcile using the same steps planned for launch;
   run end-to-end checks and automated security tests.
4. Run attendance, QR, student/parent portal, history, points and Push
   smoke tests on the *test* URL. Record release report and sign-off.
5. Rehearse restoring the original PWA/Worker routing and database
   access from known-good snapshots. Confirm who can perform that
   action when no developer is available.

## Approved cutover phase — DO NOT EXECUTE YET

1. Schedule a school-approved maintenance period. Communicate that
   check-in and late arrival submissions may be temporarily unavailable.
   Keep students/parents on the original PWA until switching.
2. **Freeze writes on the old system** at a known cutoff; ensure
   queued retries, browser offline-sync requests and Push jobs cannot
   silently write past the cutoff. Keep an audit of the cutoff.
3. Capture a final recoverable D1 backup; transfer deltas since the
   rehearsed export; reconcile counts/relationships and time-bounded
   attendance updates. Do **not** guess counts from the old 1751
   import report—compare current snapshots.
4. Verify new DB, API, Push provider, host settings and website assets
   with operator accounts on the isolated target. Keep the Node API
   inaccessible to general users until GO criteria are met.
5. Record the exact currently deployed Git commit, DB backup IDs,
   migration version, config snapshot **without secrets**, and the
   previous routes/assets.
6. Only after explicit authorized GO decision: switch client API
   routing/website assets as a coordinated atomic change, then run
   role-based login, attendance, truancy, QR, behavior, reporting,
   guardian and Push smoke tests.
7. Monitor 5xx, latency, failed writes, duplicates, Push errors,
   DB pool saturation and counts by class/period. Record the date/time
   of any first write accepted by the new system.

## Emergency rollback — non-destructive decision tree

### A. Before new system accepts real writes

- Stop attempted switch, restore previous PWA deployment and backend
  routing to the working Cloudflare Worker + D1.
- Confirm old system write access, real login, check-in and Push.
  Keep the unused Node site quarantined; preserve audit logs.
- Validate no student records changed in MariaDB; do not delete
  staging copies until the incident has been reviewed.

### B. After new system has accepted even one real write

**Never simply point users back to old D1**, because new attendance,
behavior or guardian changes may exist *only* in MariaDB. Doing so
would silently lose student data.

- Freeze writes to **both** systems and suspend retry queues, Push
  delivery and pending CSV imports.
- Export/reconcile the new writes since cutoff, verify author, timestamps,
  student/class links and conflict resolution (especially behavior
  scores, late QR and per-period attendance).
- Choose one of: verified reverse delta migration into original D1;
  manual school-approved recovery with documented audit; or remain
  in controlled maintenance until records are reconciled.
- Only after verifying data integrity and approval, restore old
  PWA/Worker routing, test key workflows, and notify staff of the
  recovery window.
- Preserve both DB backups and redacted incident logs for review.

## What is explicitly *not* ready yet

Stage 7.5–7.15 scripts only demonstrated selected isolated DB behavior
and offline contracts; the real Node HTTP handler still returns 501
for school APIs, and the school roster is not migrated into MariaDB.
Five verified triggers in **`ratsadaa_trgtest`** do not amount to the
ten D1 business-rule triggers (and their concurrency/Push parity).
The readiness gate must remain NO-GO until verified implementation
evidence exists. Future engineers should replace each hard-coded
blocker only when its required feature is implemented and tested,
not by changing flags or removing checks.

## Efficient workflow

Do not repeat many small FileZilla uploads. Implement API parity +
test-data migration in a separate batch, run offline/unit and
end-to-end tests automatically, and deliver the next **single staged
ZIP** containing source, release report and a one-command smoke test.
The three critical human decisions remain: authorize final data
backup/freeze; approve GO; approve any rollback after real writes.
