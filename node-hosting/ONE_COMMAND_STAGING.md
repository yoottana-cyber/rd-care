# RD CONNECT — One-command DirectAdmin staging test

**Use just `check:full-staging` after uploading a BATCH of changes.**

This is an **all-available-tests** command for the current migration prototype,
not a production acceptance suite or proof that every existing Cloudflare
Worker API has been ported.

## One-command workflow

1. Upload the latest experimental `node-hosting/` files **only to**
   the isolated DirectAdmin Node test app (the Cloudflare version remains
   online and unmodified). No real student exports or database copy.
2. In **DirectAdmin → Setup Node.js App → Run JS Script** choose:

   ```text
   check:full-staging
   ```

3. The script executes exactly two already-defined checks, in sequence:

   - **[1/2]** `check:all-staging` — 11 grouped offline/synthetic
     authentication, staff/guardian/student access, attendance,
     timetable/period/behavior, Push-mock and rollback checks, including
     the hard `NO_GO` release guard.
   - **[2/2]** `check:api-parity` — 41+ representative Worker route+method
     contracts, a minimum of 13 currently matching private routes,
     private vs public routing, and no-go state. Its **expected child
     exit code is 2** (intentional NO_GO); the wrapper recognizes this.

4. A correct aggregate run returns **exit 0** with:

   ```text
   [1/2] ALL STAGING GROUPS: OK (11/11).
   [2/2] API PARITY AUDIT: OK (13 private route names, 28 gaps / 41 representative contracts).
   ONE-COMMAND STAGING PASS: 11/11 grouped checks plus 1 API contract audit.
   ROLLBACK VERIFIED IN DISPOSABLE LAB / PUBLIC API STILL CLOSED.
   DATA MIGRATION INCOMPLETE / REAL PUSH NOT RUN / RELEASE STILL NO_GO.
   ```

   The name-match count may increase as ports are added. The wrapper
   rejects decreases below the verified 13 baseline, inconsistent
   totals, missing safety markers, unexpected child statuses, and errors.

## Security and scope

- Runs **no direct SQL** itself. Delegates only to the existing, approved
  staging suite (isolated synthetic MariaDB transactions that roll back)
  and offline API-inventory check.
- Does **not** call `make:d1-fixture`, `check:d1-rehearsal`, any
  `install:lab-*`, real data imports, or any Push dispatch.
- Requires staging DB and isolated trigger lab configuration; refuses
  active D1 rehearsal flags, live write flags and temporary lab permissions.
- No production HTTP API opened: login/guardian/attendance remain
  **501**, health **503**.
- Logs only allowlisted summary counters and failure stages,
  never raw TAP output, database credentials, tokens or SQL traces.
- Any exit **1** is a blocked/failed stage; stop, inspect the isolated lab,
  and do **not** disable guards to force PASS.

## Faster development rhythm

Develop and review several related **private API endpoints and their
tests** in one experimental branch/batch, then upload and run
`check:full-staging` once at the end of that batch. If the batch fails,
the stage and group summary directs focused debugging.
No need to run two separate commands after every minor API change.

The score-history, school records, student late QR, teacher timetable
writes, notifications and data migration are **not** all complete simply
because current automated checks pass. Final release remains **NO_GO**
until full route/behavior/data and backup-restore evidence has been
independently confirmed and approved.
