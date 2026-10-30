# RD CONNECT — DirectAdmin Node.js + MariaDB (Migration-only)

## Not production-ready

This folder is a **fail-closed scaffold** for an isolated school-hosting migration. It does **not** implement any of the existing RD CONNECT login, enrollment, attendance, QR, behavior, merit, admin or Push APIs yet.

- `GET /api/health` intentionally returns HTTP **503** `migration_not_ready`.
- All `/api/*` endpoints not yet ported return HTTP **501** `endpoint_not_migrated`.
- Non-API URLs return 404. This scaffold does **not** serve the existing PWA.
- No automatic MySQL connection, schema writes, Cloudflare fallback or data import occurs.
- Do not point the existing Dev PWA or any real student/guardian accounts at this app.

## Files

| File | Purpose |
|---|---|
| `app.js` | CommonJS startup for CloudLinux/Passenger, Node.js 24 |
| `src/http-handler.cjs` | Read-only API migration status, fail-closed |
| `src/database.cjs` | Future `mysql2/promise` pool (MariaDB, UTF-8, 4 connections); not called by startup |
| `package.json` | CommonJS app + mysql2 |
| `.env.example` | Placeholder environment variable names only |
| `mysql/0000_migration_ledger.sql` | Migration ledger only; not the school schema |
| `scripts/check-db.cjs` | Explicit **read-only** MariaDB connection check; no startup connection |
| `scripts/verify-schema.cjs` | Explicit **read-only** MariaDB 63-table / 119-FK baseline check |
| `scripts/check-auth-transaction.cjs` | Isolated **transactional** test: fake user/hash/session, then ROLLBACK |
| `src/test-auth-crypto.cjs` | Scrypt helpers for the smoke test; NOT backward-compatible with existing D1 password hashes |
| `scripts/inspect-d1-schema.cjs` | Offline schema-only D1 export inventory; refuses files containing INSERT data |
| `test/migration-preflight.test.cjs` | Tests for safe read-only connectivity and schema inspection |

## Local smoke test

From `node-hosting/` on a machine with Node 24:

```sh
npm install
npm start
```

Then open `http://127.0.0.1:3000/api/health` (expected 503). Stop with Ctrl+C. Nothing is written to any database.

## DirectAdmin URL-prefix diagnostic (school staging)

Application URL is `https://ratsada.ac.th/web/rd-connect-node-test`.
CloudLinux Passenger may forward requests with the entire path
`/web/rd-connect-node-test/api/health` or strip that mount path and pass
`/api/health`. The staging HTTP router now accepts **both** forms.

After uploading the latest `src/http-handler.cjs`, restart the Node app and open:

`https://ratsada.ac.th/web/rd-connect-node-test/api/health`

Expected: HTTP **503** with JSON `{"ok":false,"service":"RD CONNECT school Node.js migration","error":"migration_not_ready"}`.
This is intentional and means **Node.js routing works**, not that MariaDB or the application is ready.
Opening the application root URL `/web/rd-connect-node-test/` returns `404 not_found` by design:
the migration-only shell has no homepage or frontend.

If health still returns `404 not_found`, inspect the app's `src/http-handler.cjs` on the server,
confirm that the file contains `STAGING_MOUNT_PATH`, then restart Passenger.
Do **not** alter `/web/rd-connect/` or any D1/Worker environment settings.

## Stage 0: verify MariaDB access (separate empty TEST database)

1. In DirectAdmin create a **new, empty staging** MariaDB database and a restricted test database user. Do not select the database used by any current school website.
2. In the staging Node.js app's **Environment Variables** editor set `RD_DB_HOST`, `RD_DB_PORT`, `RD_DB_NAME`, `RD_DB_USER`, and `RD_DB_PASSWORD`. Do not share credentials in chat, screenshots or GitHub.
3. Install dependencies (`npm install`) using the Node.js Selector and open its activated terminal.
4. Run this explicit command **only in the staging application root**:

```sh
npm run check:db
```

Expected: `RD CONNECT MariaDB staging: connection OK (read-only SELECT 1).`. The script makes **one read-only SELECT**, closes its connections, never prints secrets and does not create tables or write rows. A failure prints a safe error category. The HTTP app still responds `503 migration_not_ready`.

For investigating the actual D1 schema, run this command **on your own computer** inside the existing `worker` directory (Wrangler login required):

```sh
npx wrangler d1 export rd-care-dev --remote --no-data --output=rd-connect-schema-only.sql
```

**Caution:** A Cloudflare D1 export may temporarily block database requests. Schedule it outside school usage. This export contains **schema only, not student records**.

Then run from the `node-hosting` directory on the same computer:

```sh
npm run inspect:d1 -- ../worker/rd-connect-schema-only.sql
```

The inspector reports table/index/trigger/view counts, executes **no SQL**, and rejects exports containing INSERT statements. Its report is an inventory, **not a MySQL conversion**; SQLite triggers, partial indexes and permissions must be ported and tested before any real-data import.

## Stage 1: Verify the actual empty MariaDB schema (school test database)

School test DB `ratsadaa_connect` was inspected in phpMyAdmin with **63 tables, 119 FKs,
0 triggers, `student_enrollments.end_date = varchar(10)`, 2 named unique indexes**.
The user ran the three-part warning-1901 fix, and those numbers match the expected staging baseline.
This is **not sufficient for use with real students**: 10 SQLite business-rule triggers
and the entire application API still need careful porting.

After updating the following two files in `rd-connect-node-stage/`:
- `package.json`
- `scripts/verify-schema.cjs`

Open DirectAdmin → Setup Node.js App → `rd-connect-node-stage` → Run JS Script,
and choose `verify:schema`. This is the equivalent of running `npm run verify:schema`
and only reads MariaDB `information_schema` metadata.

Expected exit code `0` and `SCHEMA CHECK OK`; the script prints the five numeric/type
checks and says that business-rule triggers are not ported. It does **not** read
personal records, change schema, import data, or modify Cloudflare.
On a mismatch, it exits nonzero and lists the mismatching metadata fields.
Do not point the existing school PWA at this Node application yet.

## Stage 2: Test fake-account authentication and session storage (NOT live login)

**Prerequisites:** Node.js `verify:schema` returned `SCHEMA CHECK OK` for the same
isolated MariaDB database, `ratsadaa_connect`. This command is intended for a
new **empty** test database only. It refuses to run if `users`, `students`,
`portal_accounts`, or `sessions` already contain records, if database name
is not exactly `ratsadaa_connect`, or if the relevant storage tables are not InnoDB.

Update these three files inside `/home/ratsadaa/rd-connect-node-stage/` using FTP:
- `package.json`
- `src/test-auth-crypto.cjs`
- `scripts/check-auth-transaction.cjs`

In DirectAdmin → Setup Node.js App → `rd-connect-node-stage` → Run JS Script,
select `check:auth-txn` (equivalent to `npm run check:auth-txn`).

The command generates a random fake teacher username and random password in
memory; hashes the password with scrypt, inserts this test account and a SHA-256
session token hash using **parameterized SQL inside one InnoDB transaction**,
verifies correct/wrong passwords and the temporary session, and then calls
`ROLLBACK`. It checks that neither the temporary user nor its session remains.
As with any InnoDB rolled-back insert, the AUTO_INCREMENT counter may advance,
but **no fake user/session row remains**.

Expected: `returncode: 0`, `STEP 6.2 OK`, and `ROLLBACK VERIFIED`.
On errors it prints a broad category without leaking the generated password,
tokens or SQL row data. If the script refuses a non-empty database, **do not
delete the rows**; it is a safety condition.

This is **not a production Login API** and is not compatible with D1 PBKDF2
passwords. No `/api/auth/login` route is added or enabled. Until all 10 missing
business-rule triggers, privacy checks, role permissions and audit protections
are ported, do not import any real student accounts or point the existing PWA
at this Node.js staging app.

## DirectAdmin trial setup

Use a **separate staging subdomain** with HTTPS and a newly created MySQL database. Do not install over `ratsada.ac.th`:

- Node version: `24.20.0` for initial testing; request latest patched 24.x before production.
- Application mode: `Development` for test only.
- Application root: `rd-connect-node-stage` (outside `public_html`)
- Application URL: separate staging subdomain `care-test.ratsada.ac.th` after school approval.
- Startup file: `app.js` (CommonJS, required by CloudLinux Passenger).
- Use hosting-provided `PORT`; do not hardcode a public port.
- Install NPM dependencies via the Node.js selector. Check Passenger log if startup fails.

Credentials must be entered only through the host's secure environment editor, not copied to GitHub or chat. Credentials for the **new empty staging database** may be set to run the explicit read-only check above; do not import real student data while the schema and API are incomplete.

**Do not switch the school website's PHP 7.4 or modify the existing Cloudflare Dev Worker/D1.**

The full migration, data protection, test plan, Cron/Push checklist and security caveats are in `docs/NODE-MARIADB-MIGRATION-PLAN.md`.
