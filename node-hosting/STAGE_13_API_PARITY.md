# RD CONNECT — Stage 13: API contract inventory (NO_GO)

## Grounded findings

This is an **offline, representative route/method inventory**, not application parity. On 31 October 2026 the Cloudflare Worker source was compared against the **unexposed** Node staging-auth and school-read adapters. The Worker endpoint `GET /api/portal/records` returns a compound guardian/student view: student details, daily + per-period attendance, late, truancy, behavior incidents and positive deeds with **separate point totals**. This is used by the existing portal UI.

The experimental Node adapter exposes the **internal** endpoints `GET /api/portal/attendance` and `GET /api/portal/behavior` instead, with narrower/different response shapes. It has no matching `GET /api/portal/records`. A direct PWA cutover would therefore break this high-priority portal workflow.

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
PORTAL PATH MISMATCH: Worker /api/portal/records vs Node prototypes ...
PUBLIC PASSENGER API CLOSED: login, guardian records and attendance are still 501; health is 503.
STAGE 13 NO_GO: ...
```

No secrets or student data is accessed. It does not connect to MariaDB or D1, execute imports, modify the database, send Push, or start a listener. The result is **NOT** proof of compatibility.

The priority contract list is curated from `worker/src/worker.js`, `portal.js`, `teacher-timetable.js`, `student-affairs.js`, `staff-push.js`, and `late-qr.js`; it is **not exhaustive**. Existing auth and school-read Node routes are discovered from their *actual* internal route maps, rather than asserted implemented by an arbitrary checklist.

## Requirements for the next implementation PR

1. Implement the precise Worker `/api/portal/records` endpoint and compatible response fields, including verified guardian/student ownership, correct 90-day limits, behavior warning-vs-penalty distinctions, separate goodness and conduct ledgers, and school date/time semantics. Use fully synthetic test cases and deliberately invalid cross-account requests.
2. Audit the remaining actual Worker routes, including dynamic parameters, notification settings, CSV, year/term history and staff/student/guardian Push.
3. Compare exact HTTP status codes and JSON schemas, role authorization, idempotency, audit events and transactional side effects against source on the same synthetic scenarios.
4. Verify all MariaDB business rules, migration hashes/counts, backups/restores and release gates before enabling ANY Passenger public API.
5. Keep original Cloudflare D1/Worker/PWA running independently. The Node release remains **NO_GO**, PR stays Draft.

Even 100% route-name matches cannot justify production without full data and functional parity.
