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
| `src/d1-password-compat.cjs` | D1 PBKDF2-SHA256 compatibility verifier (legacy 100k and rd2$ 20k) |
| `src/staging-auth-service.cjs` | Unexposed staff/student/guardian Login, Me and Logout logic; NOT connected to HTTP |
| `src/staging-auth-http.cjs` | Unexposed HTTP JSON adapter for six Login/Me/Logout routes; no public listener |
| `scripts/check-auth-http.cjs` | Offline in-process HTTP contract test; no DB, no network socket |
| `scripts/check-auth-http-db.cjs` | Isolated in-process HTTP → auth service → MariaDB integration test; rolls back all rows |
| `scripts/check-password-compat.cjs` | Offline, synthetic test of original Worker password formats; no DB access |
| `scripts/check-auth-service.cjs` | Transaction-only real MariaDB test across teacher/student/guardian fake accounts; ROLLBACK |
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

## Stage 3: Verify password-format compatibility BEFORE porting real Login APIs

Read the existing Cloudflare Worker `worker/src/password.js`: its current
password hashes are **PBKDF2-SHA256**, with UTF-8 salt bytes, **100,000
iterations for unprefixed salts** and **20,000 iterations for `rd2# RD CONNECT — DirectAdmin Node.js + MariaDB (Migration-only)

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
| `src/d1-password-compat.cjs` | D1 PBKDF2-SHA256 compatibility verifier (legacy 100k and rd2$ 20k) |
| `scripts/check-password-compat.cjs` | Offline, synthetic test of original Worker password formats; no DB access |
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

-prefixed
salts**. The **scrypt** from `check:auth-txn` was only an isolated test and is
**not compatible** with real D1 accounts.

Update these three files on school staging through FTP:
- `package.json`
- `src/d1-password-compat.cjs`
- `scripts/check-password-compat.cjs`

In DirectAdmin → Setup Node.js App → `rd-connect-node-stage` → Run JS Script,
run `check:password-compat`. Expected: `returncode: 0`, `STEP 6.3 OK`,
and `AUTH API STILL DISABLED`. This verifier uses only synthetic independent
SHA-256 vectors (including Thai UTF-8 text) and does **not** query MariaDB,
Cloudflare or reveal stored hashes.

**Security note:** Worker-trial PBKDF2 20k is below what we should retain for
a real school student-data deployment. Password verification must support
existing hashes during migration, but the future live login implementation must
upgrade valid accounts to a stronger password hashing scheme, e.g. a carefully
tuned Argon2id/scrypt, without silently reinterpreting existing salts.
The Node.js HTTP app remains deliberately fail-closed while we port login,
permission checks and all business-rule triggers.

## Stage 6.4: Staff / student / guardian authentication service (internal test only)

The original D1 endpoints are `POST /api/auth/login` (staff/teacher),
`POST /api/portal/auth/login` (student + guardian), and corresponding
`/auth/me` and `/auth/logout` routes. They use a lowercase username,
`password_salt` + hex PBKDF2 hash, SHA-256 of a random bearer token in
`sessions` or `portal_sessions`, and optional `remember` for 30 days
instead of the ordinary 8 hours. The ported internal service follows those
contracts, with portal roles checked separately. Wrong passwords increment
lockout state; five failures lock a username for 15 minutes.

**This implementation is deliberately NOT wired to `http-handler.cjs`.**
All HTTP `/api/auth/*` and `/api/portal/auth/*` paths still return HTTP 501
`endpoint_not_migrated`; `/api/health` still returns HTTP 503.

Transfer only these three updated/additional files by FTP to
`/home/ratsadaa/rd-connect-node-stage`:
- `package.json`
- `src/staging-auth-service.cjs`
- `scripts/check-auth-service.cjs`

They depend on `src/d1-password-compat.cjs` and
`scripts/check-auth-transaction.cjs`, already installed in earlier steps.
In DirectAdmin → Setup Node.js App → Run JS Script, run **`check:auth-service`**.

Expected output:
`returncode: 0` plus `STEP 6.4 OK`, `ROLLBACK VERIFIED`,
and `PUBLIC API DISABLED`. The smoke test **refuses** nonempty
`users`, `students`, `portal_accounts`, `sessions` and related
staging tables, wrong database name, or non-InnoDB tables.
It creates random synthetic staff, classroom, pupil and portal accounts
inside a transaction, tests correct/wrong password, role mismatches,
Bearer session login/me/logout and 8-hour vs 30-day expiration, then
rolls back the entire transaction. **It may advance AUTO_INCREMENT
counters, but leaves no user/classroom/student/session rows.**

Before switching any real PWA to this app, implement and audit concurrent
login lockout handling, strong password hash upgrades, all authorization
boundaries, the 10 missing SQLite business-rule triggers, and a full
migration dry run on an anonymized dataset.

## Stage 6.5: test the HTTP request/response contract without exposing Login

Added an **isolated** HTTP adapter at `src/staging-auth-http.cjs` for:
`/api/auth/login`, `/api/auth/me`, `/api/auth/logout` and portal
equivalents. The adapter parses JSON safely with an 8 KiB body limit,
requires correct HTTP methods, emits no-store JSON errors and does not allow
CORS by default. It requires explicit dependency injection of a DB
connection and is **NOT imported by `app.js` or `src/http-handler.cjs`**.

The `check:auth-http` script verifies these contracts with synthetic requests
**in-process**. It uses **no network port, no school DB credentials or
queries, no real account records and no external requests**. The active
Passenger handler still responds HTTP 501 `endpoint_not_migrated`
for all public auth endpoints, including `/api/auth/login`.
It is a component readiness check, **not** a real public-endpoint test.

Upload only these three files from the branch into the existing staging Node root:
- `package.json`
- `src/staging-auth-http.cjs`
- `scripts/check-auth-http.cjs`

In DirectAdmin → Setup Node.js App → Run JS Script, run `check:auth-http`.
Expected `returncode: 0`, `STEP 6.5 OK`, `NEGATIVE TESTS OK`,
and `PUBLIC AUTH STILL CLOSED`. If the script fails, do not
connect the HTTP adapter to the public server.

Before actually enabling a trial Login endpoint, complete further safety
checks, add a network-safe test-account isolation boundary, decide and
test password-hash upgrades, review brute-force concurrency and session
management, plus access controls and the ten missing business-rule triggers.
Do not change the existing school's Cloudflare Worker/D1/PWA.

## Stage 6.6: End-to-end in-process HTTP adapter + actual staging MariaDB

After the separate tests in stages 6.4 (database auth service) and 6.5
(HTTP request contract), run the combined **`check:auth-http-db`**.
It passes synthetic HTTP requests through the **unexposed** HTTP adapter,
the auth service, and the real MariaDB `ratsadaa_connect` connection.

Preflight refuses wrong DB name, nonempty authentication / roster tables
and non-InnoDB tables. It creates random fake teacher, classroom, student
and guardian records inside one transaction. It checks wrong passwords,
role mismatches, Login/Me/Logout, token revocation, and 8-hour vs 30-day
session durations. The whole transaction is rolled back; it verifies
no synthetic accounts, sessions, login attempts or roster rows remain.
AUTO_INCREMENT counters may advance even after ROLLBACK. No real student
information is imported and no actual public login endpoint is enabled.

Upload two updated/new files into `/home/ratsadaa/rd-connect-node-stage/`:
- `package.json`
- `scripts/check-auth-http-db.cjs`

Dependencies `scripts/check-auth-http.cjs`,
`scripts/check-auth-service.cjs`,
`src/staging-auth-http.cjs`,
`src/staging-auth-service.cjs`,
`src/d1-password-compat.cjs` must already be present from the previous stages.

In **DirectAdmin → Setup Node.js App → Run JS Script**, run
`check:auth-http-db`. Expect `returncode: 0`, `STEP 6.6 OK`,
`ROLLBACK VERIFIED`, and `HTTPS LOGIN NOT ENABLED`.

The public Passenger `app.js` and `src/http-handler.cjs` stay unchanged:
`/api/auth/login` and `/api/portal/auth/login` continue returning
HTTP 501 `endpoint_not_migrated`. An HTTP adapter being tested in process
is **not** permission to expose it to the internet. Production auth still
needs concurrency-safe rate limiting, password-hash upgrades, hardened
session expiry/refresh, thorough authorization tests, recovery, monitoring,
and business-rule trigger parity.

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
