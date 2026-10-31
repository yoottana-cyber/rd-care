# RD CONNECT — SQLite D1 → MariaDB Trigger Parity Plan (school staging)

**Status: PLANNING ONLY. No trigger DDL or data migration has been applied.**
The school staging MariaDB `ratsadaa_connect` has 63 tables,
119 foreign keys and **0 triggers**. These were verified in phpMyAdmin
and using `npm run verify:schema`. Login/in-process/HTTPS probes have
passed using synthetic accounts and `ROLLBACK` only. The original
Cloudflare Worker+D1 and PWA must remain untouched.

The trigger inventory below is derived from the actual schema-only
D1 export `rd-connnect-schema-only(1).sql` (2026-10-30).
There are precisely **10** CREATE TRIGGER declarations; do **not**
pretend table/FK parity means behavior parity.

| Original D1 trigger | Event/table | Required MariaDB behavior and validation |
|---|---|---|
| `guardian_link_role_guard` | BEFORE INSERT `guardian_student_links` | Reject linking a non-guardian portal account. Ensure UPDATE cannot subvert links even if D1 only guards INSERT. Test missing account, student account, valid guardian. |
| `timetable_clash_insert` | BEFORE INSERT `timetable` | Reject teacher or classroom time-range intersections for active lessons on same weekday. Preserve multi-period inclusive overlap semantics and inactive rows. |
| `timetable_clash_update` | BEFORE UPDATE `timetable` | Same rejection for updates that change day/period/room/teacher/active. Exclude OLD.id; verify switching inactive→active, moving classes and concurrent submissions. |
| `behavior_incident_record_deleted` | AFTER UPDATE `behavior_records` | Propagate soft-delete timestamp to linked `behavior_incidents`. Old NULL → new non-NULL only; do not cascade unrelated changes. |
| `behavior_incident_record_restored` | AFTER UPDATE `behavior_records` | Restore corresponding linked incidents on NULL restoration, without resurrecting unrelated rows. |
| `truancy_auto_score_on_insert` | AFTER INSERT `period_truancy` | Restore previous same-lesson incident/score if appropriate; else create an incident based on `truancy_score_policy`, rule category and previous active violation count. Preserve minor/moderate warning thresholds, custom points, Thai reason with lesson range, and legacy linkage. Idempotent one incident per student/lesson/date. |
| `truancy_auto_score_on_delete` | AFTER DELETE `period_truancy` | Soft-delete linked scores and incidents and record audit event when truancy is reversed. Ensure repeat corrections do not create duplicate point deductions. |
| `behavior_score_notification_on_deduction` | AFTER INSERT `behavior_incidents` | Add a push event once for active negative points; no event for positive or deleted entries. Retry/outbox semantics must be equivalent. |
| `behavior_warning_notification_on_insert` | AFTER INSERT `behavior_incidents` | Add a push event once for zero-point minor/moderate warnings with `warning_no>0`. |
| `behavior_incident_apply` | AFTER INSERT `behavior_incidents` | For nonzero points create `behavior_records` and link exactly its inserted id to that incident, plus insert the correct audit action for warning vs deduction. |

## Implementation constraints

1. MariaDB **10.4** is an old/EOL server version. Before production use, ask
   the hosting provider to upgrade to a supported patched release. Do not
   assume MySQL 8 syntax or trigger semantics work on MariaDB 10.4.
2. SQLite `RAISE(ABORT,...)` must map to MariaDB `SIGNAL SQLSTATE '45000'`
   or a safely checked application transaction; never silently skip rejection.
3. SQLite `AFTER UPDATE OF column` is not a MariaDB trigger event: use a
   standard UPDATE trigger with old/new-value guards.
4. SQLite `INSERT OR IGNORE`, `ON CONFLICT`, string concatenation
   `||`, `CAST(... AS TEXT)`, and `last_insert_rowid()` all need deliberate
   MariaDB equivalents with reviewed null/charset/collation handling.
   In particular, `LAST_INSERT_ID()` and trigger nesting require tests to
   ensure the correct behavior-record ID is linked to each incident.
5. Multiple `AFTER INSERT` triggers exist on `behavior_incidents`.
   Define and test their activation order, compatibility with foreign keys,
   nested trigger behavior and any restriction on writing to tables already
   used by an invoking statement. Avoid relying on implicit trigger ordering.
6. Validate every UNIQUE/partial SQLite index separately, especially
   `end_date IS NULL` generated-column indexes and deduplication
   `behavior_incidents` source lesson / request keys. Nulls and casefold
   behavior may differ on MariaDB.
7. **Never** create triggers directly against the production D1/Worker.
   Apply one reviewed migration to a *separate empty or synthetic-only*
   MariaDB test database, with a tested backup/rollback plan. MariaDB DDL
   auto-commits, so application `ROLLBACK` is not a DDL rollback.
8. Test the rules with explicit teacher/adviser/staff/student-affairs
   authorization and privacy boundaries at the API layer as well as DB
   constraints. A trigger is not an authorization system.
9. The existing period-truancy behavior scoring logic depends on multiple
   tables/triggers. Disabling one trigger can break score history, warning
   thresholds or push events; test the complete chain as an atomic unit.
10. No real student identifiers, login secrets, guardian links or notifications
    should be used for these tests. Mock Push delivery while validating
    outbox creation.

## Required acceptance scenarios before actual school data import

- Guardian account vs student-account link; denied update bypass; nonexistent
  link parent; deletion and reassignment.
- Timetable overlap at period endpoints and consecutive non-overlap;
  teacher clash across rooms, same-room clash across teachers; inactive
  lesson and update to active; simultaneous inserts.
- First/second/third minor warning; moderate first warning; configured
  deduction; duplicate lesson and modified lesson periods; deleted/undeleted
  truancy on the same date.
- Behavior record→incident soft-delete propagation and restoration,
  including secondary audits, no duplicated behavior points and no
  deletion of unrelated cases.
- Exactly-once event creation for negative points and qualifying warnings;
  zero points non-warning should not create an event.
- Full `behavior_incident_apply` audit trail; correct `behavior_record_id`
  under multiple students and concurrent inserts.
- All tests use synthetic records inside transactions; only *data* are rolled
  back. Verify no residue after tests and run before any production switch.
- After all triggers are implemented, change the schema baseline from
  0 to 10 **only after** verified MariaDB parity and review.
- Keep all public Node.js Login endpoints disabled (501) and health as
  migration_not_ready (503) until the API/trigger/security migration is
  actually complete.

## HTTPS probe closure after successful stage 6.8-B

The stage 6.8 one-shot `/api/migration/auth-probe` is not needed for normal
operation. Immediately set `RD_AUTH_HTTPS_PROBE_ENABLE=0`, **delete**
`RD_AUTH_HTTPS_PROBE_SECRET` and `RD_AUTH_HTTPS_PROBE_UNTIL` from the
DirectAdmin environment, and restart Passenger. Confirm an unauthenticated
GET to that URL produces HTTP 404 `not_found`, not HTTP 405.
The static transport probe may remain enabled.
