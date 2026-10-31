# RD CONNECT — Stage 13 guardian truancy feed (INTERNAL ONLY)

## Result from prior stage

The school operator confirmed on DirectAdmin (31 Oct 2026):
- `check:api-parity` exited **2** by design (41 priority routes, 12 internal route+method names matched, 29 missing, public API 501/503, release NO_GO).
- `check:all-staging` exited **0**, all **11/11** group checks passing, synthetic rollback verified, no real school records modified.

## What changes in this stacked branch

The original Cloudflare Worker has `GET /api/portal/truancy` in
`worker/src/portal.js`, implemented by `guardianTruancyItems` in
`worker/src/truancy-push.js`.

This change ports the same **PRIVATE** route to the Node staging injected-connection adapter:
- Only authenticated guardians receive entries; students receive an empty list.
- Rows are additionally restricted to guardian accounts still active and linked
  to an **active** child.
- Events must be active, backed by `period_truancy` and an
  `attendance_period.status='absent'` record; old/corrected events do not appear.
- Optional `from` + `to` range must be valid and no longer than 90 days,
  inclusive. Without dates, the SQL uses `UTC_DATE()` minus 30 days,
  matching the existing Worker UTC date-default behavior.
- Results return `{items:[{id,student_id,school_date,period,subject,full_name,created_at}, ...]}`,
  ordered newest first with a hard 40-row limit.
- Prepared/parameterized SQL; no D1 access, no writes, no real Push.
- The old Passenger HTTP handler remains unchanged, so the public API
  **still replies 501** and health replies **503**.

## Run on the isolated school DirectAdmin staging app

Upload the `node-hosting/` contents from branch
`feature/stage13-portal-truancy-private` to **only** the isolated
school Node test app, without changing DB credentials or enabling public
routes.

1. `check:api-parity` should return **2**: 41 representative routes;
   **13** matching private route+method names, **28** still unmatched.
   `STAGE 13 NO_GO` must remain visible.
2. `check:all-staging` should return **0**, **11/11**; its existing
   disposable lab HTTP journey now covers guardian + student truancy
   feed responses (the fixture contains no standalone `truancy_events`)
   and rejects incomplete date ranges.
3. If unexpected failure, stop and inspect the isolated lab; do not
   bypass guards or merge the PR.

This is **not** full Push / truancy lifecycle parity. The positive-event
scenarios, corrected-record race conditions, data migration, and complete
school deployment remain unverified. Do not merge experimental PRs to
`main` or switch the production PWA.

## Known limitations

Matching route names do not establish JSON/date/permission parity. The
private implementation has offline mocked positive-event tests and lab
empty-feed checks; a future isolated rollback-only test with a real
synthetic active `truancy_events` row should confirm the MariaDB join
and correction lifecycle before considering any release.
