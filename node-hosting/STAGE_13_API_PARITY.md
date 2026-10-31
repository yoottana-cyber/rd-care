# RD CONNECT — Stage 13: API contract inventory (NO_GO)

## Grounded findings

This is an **offline, representative route/method inventory**, not application parity. On 31 October 2026 the Cloudflare Worker source was compared against the **unexposed** Node staging-auth and school-read adapters. The Worker endpoint `GET /api/portal/records` returns a compound guardian/student view: student details, daily + per-period attendance, late, truancy, behavior incidents and positive deeds with **separate point totals**. This is used by the existing portal UI.

**Stage 13 private implementation update:** the experimental Node adapter now exposes the **internal** `GET /api/portal/records` with the Worker-compatible response fields (student, daily, period, late, truancy, behavior, good, independent score totals and note), restricted to authenticated linked guardians or the student account itself. It uses parameter-bound SQL and 90-day validation; offline mock tests and an isolated synthetic MariaDB transaction lab exercise authorization and response shape. The older private helper endpoints `GET /api/portal/attendance` and `GET /api/portal/behavior` remain, but are not substitutes for the original endpoint. **This is not yet proven against full real-world historical/edge-case records; public Passenger deliberately remains 501.**

Other known major gaps: daily/period attendance POST side effects; permanent student QR auto-approval; timetable writes; behavior warnings and score ledger; administrative imports and school settings; Web Push provider/recipient scheduling; keep-alive session behavior and account lifecycle. These require full authorization, chronology, concurrency, retry and side-effect contracts, not merely route aliases.

## Safe audit

From the isolated DirectAdmin Node app, run:

```text
check:api-parity
```

Expected exit **2** even when the inventory and fail-closed HTTP checks pass:

```text
STAGE 13 API ROUTE AUDIT OK: ... representative Worker route+method contracts inventoried.
PRIVATE ROUTE NAME+METHOD FOUND: ... (response shape, SQL and permissions NOT verified).
NO MATCHING PRIVATE ROUTE: ...
PORTAL RECORDS PRIVATE ROUTE FOUND: Worker /api/portal/records now has a matching internal GET route; full behavior/schema parity remains unverified.
PUBLIC PASSENGER API CLOSED: login, guardian records and attendance are still 501; health is 503.
STAGE 13 NO_GO: ...
```

No secrets or student data is accessed. It does not connect to MariaDB or D1, execute imports, modify the database, send Push, or start a listener. The result is **NOT** proof of compatibility.

The priority contract list is curated from `worker/src/worker.js`, `portal.js`, `teacher-timetable.js`, `student-affairs.js`, `staff-push.js`, and `late-qr.js`; it is **not exhaustive**. Existing auth and school-read Node routes are discovered from their *actual* internal route maps, rather than asserted implemented by an arbitrary checklist.

## Requirements for the next implementation PR

1. Verify the newly implemented **private** `/api/portal/records` against realistic anonymized/synthetic edge cases: guardian link reassignment, expired/revoked sessions, zero-point warnings, merged/archived records, SQL time-zone behavior, date bounds and score aggregation; run the 11-group suite on the school's isolated disposable MariaDB lab and confirm ROLLBACK.
2. Audit the remaining actual Worker routes, including dynamic parameters, notification settings, CSV, year/term history and staff/student/guardian Push.
3. Compare exact HTTP status codes and JSON schemas, role authorization, idempotency, audit events and transactional side effects against source on the same synthetic scenarios.
4. Verify all MariaDB business rules, migration hashes/counts, backups/restores and release gates before enabling ANY Passenger public API.
5. Keep original Cloudflare D1/Worker/PWA running independently. The Node release remains **NO_GO**, PR stays Draft.

Even 100% route-name matches cannot justify production without full data and functional parity.

## Stage 13 private portal records test branch

Branch `feature/stage13-portal-records-private`, stacked above the Stage 13 API audit branch, adds the missing read-only private endpoint and lab-backed tests. After updating the isolated Node-hosting files, run:

```text
check:api-parity
```

Expected **exit 2**: 41 representative endpoints; **12 private name+method matches / 29 remaining**; `PORTAL RECORDS PRIVATE ROUTE FOUND`; Passenger still 501/503; `STAGE 13 NO_GO`.

Then run `check:all-staging`. Expected **exit 0 / 11 of 11** with the new synthetic guardian/student record checks in the existing rollback-only lab, **if and only if** all test contracts and schema match. An exit 1 means stop and inspect the lab; do not bypass private authorization or test guards.
