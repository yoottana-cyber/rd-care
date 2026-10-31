# RD CONNECT — DirectAdmin Node.js + MariaDB (Migration-only)

## Stage 12 — private synthetic JSONL → MariaDB rollback rehearsal

See [Stage 12 instructions](./D1_REHEARSAL.md). Run `make:d1-fixture` to
generate a **fictional, disabled teacher account** plus 62 empty JSONL tables
from the read-only metadata of the empty staging DB — **no D1 export or real
school records**. Temporarily opt in to `check:d1-rehearsal` with the
synthetic-only manifest and check unconditional ROLLBACK plus 63 empty tables.
The usual 11-group test remains safe; no stage-12 import happens automatically.
This is **not full D1 schema/data/application parity or go-live approval**.


## Consolidated Batch 1 + Batch 2 (offline school APIs + D1 migration preparation)

The combined application/data groundwork has been added to this
**experimental** branch. See [`BATCH_1_2_GUIDE.md`](./BATCH_1_2_GUIDE.md)
for the single ZIP upload, test command, private D1 export method and
explicit remaining work.

- Batch 1: token-backed, scoped **read-only** school and portal service,
  plus an unexposed GET-only HTTP adapter. **Not full API parity.**
- Batch 2: private local D1 SQL→JSONL exporter, manifest SHA/count
  validation, MariaDB source/target FK load plan, and read-only
  row-count/FK reconciliation. **Not a live data importer.**
- From a freshly downloaded branch ZIP, upload the full contents of
  `node-hosting/` into the existing DirectAdmin Node test app.
  Do not overwrite secret environment settings or copy private data.
- Run `check:batch12` once in DirectAdmin → Run JS Script.
  It runs the offline API and data-integrity regression suites.
  With no private D1 export manifest configured, its **EXPECTED**
  exit code is **2** (`BATCH 2 SOURCE PENDING`). This is an
  intentional **NO-GO**, not a failure of the tests.
- `check:go-live` from Release Pack 3 remains intentionally NO-GO
  until full functional parity, authorized migration and backup
  restoration/reconciliation are verified.

No public APIs are enabled; `src/http-handler.cjs` and
`app.js` remain unchanged. No current Cloudflare D1 data,
`ratsadaa_connect`, `ratsadaa_trgtest`, DNS or live PWA is changed.
Do not merge this branch into `main`.

## Release Pack 3 — Pre-launch readiness, backup and rollback

The school selected the consolidated **pre-launch package** instead of
continuing one tiny step at a time. See
[`RELEASE_RUNBOOK.md`](./RELEASE_RUNBOOK.md) for the GO/NO-GO decision
criteria, data migration prerequisites, cutover sequence, and the
critical difference between rollback *before* versus *after* the
new MariaDB accepts real school writes.

The read-only `check:go-live` script is registered in
`package.json` and checks the isolated staging DB inventory,
staging HTTP closure, missing production modules and lingering test
permissions. It does not make the migration ready.
**Expected current result: exit code 2 and `RELEASE READINESS NO_GO`.**
Exit code 1 means an unsafe or unknown baseline.
Exit code 0 is intentionally not available until the missing APIs,
D1 data migration, backup restoration and release checks are
implemented and independently verified.

From this branch upload these **three files** to the existing
DirectAdmin Node test directory:
`package.json`, `src/release-readiness.cjs`,
`scripts/check-go-live-readiness.cjs`.
Then run `check:go-live` via DirectAdmin → Setup Node.js App →
Run JS Script **without adding any new environment flag**.
Do not add real student records or change `main` or live URLs.

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
| `scripts/check-https-transport.cjs` | Offline test of new static transport-only probe and closed public Login routes |
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

## Stage 6.7: check actual HTTPS transport without exposing authentication

The public staging HTTP handler now supports **only** one new, static,
unprivileged GET route: `/api/migration/transport`. It returns HTTP 200
with `{"ok":true,"check":"transport_only","login_enabled":false,"migration_ready":false}`.
It does **not** look up a password, connect to MariaDB, read a school record,
expose secrets or assert the app is ready.

**Files to update on school staging:**
- `package.json`
- `src/http-handler.cjs`
- `scripts/check-https-transport.cjs`

1. Use DirectAdmin → Setup Node.js App → Run JS Script to select
   `check:https-transport`. Expected `returncode: 0` and
   `STEP 6.7 LOCAL OK`. The script only verifies the locally loaded
   HTTP routing; it does NOT test the real HTTPS connection.
2. **Restart** the `rd-connect-node-stage` Node.js app, so Passenger
   loads the new `src/http-handler.cjs`.
3. In a browser, open
   `https://ratsada.ac.th/web/rd-connect-node-test/api/migration/transport`.
   Expected HTTP 200 with the exact JSON above (shows HTTPS termination and
   Passenger route work from that browser).
4. Open `https://ratsada.ac.th/web/rd-connect-node-test/api/health`.
   Expected HTTP 503 JSON `migration_not_ready` (intentional).
5. Open `https://ratsada.ac.th/web/rd-connect-node-test/api/auth/login`
   and `https://ratsada.ac.th/web/rd-connect-node-test/api/portal/auth/login`.
   A browser GET must return HTTP 501 `endpoint_not_migrated`.
   Do **not** enter real usernames or passwords in requests.

A failed or different status is a reason to stop and inspect the
application path/Passenger deployment, not to activate Login. The existing
`/web/rd-connect/` frontend, Cloudflare Worker/D1 and student accounts
are completely untouched.

**Next step (not yet enabled):** Only after test-user isolation,
concurrency-safe login limits, secret handling, and password-hash upgrade
are in place, evaluate tightly restricted HTTPS auth testing in a separate
environment, then role-based authorization and business-rule trigger parity.

## Stage 6.8: Opt-in, one-shot HTTPS authentication transaction (TEST only)

Precondition: stages 6.2–6.7 passed, including rollback, password
compatibility, and the HTTPS transport probe. Public Login is still
HTTP 501, and the real RD CONNECT Cloudflare PWA/D1 must remain unchanged.

The staging-only `POST /api/migration/auth-probe` is **disabled by default**.
When explicitly enabled with all three correct environment settings below,
it runs the **synthetic** HTTP Login/Me/Logout → MariaDB integration check
used in stage 6.6, within a transaction, and verifies a full rollback.
The probe does not accept user data, does not log passwords or tokens, and
does not expose the real Login routes. It requires a 32-byte random
hexadecimal secret sent in `X-RD-HTTPS-Probe-Secret`, expires no more than
one hour after the current time, and permits at most one authorized
execution per Node.js process restart.

**Upload to `/home/ratsadaa/rd-connect-node-stage/`:**
- `package.json`
- `src/http-handler.cjs`
- `src/https-auth-probe.cjs`
- `scripts/check-https-auth-gate.cjs`

The older `scripts/check-auth-http-db.cjs` and supporting auth code must
already be in place from the previous stages. DO NOT update the live PWA.

**Phase A — Verify the disabled-by-default gate before using secrets.**
With **no new env vars set**, DirectAdmin → Setup Node.js App →
Run JS Script → `check:https-auth-gate` must return code 0 and
`STEP 6.8 GATE OK`. This checks all guards using an in-memory fake pool
and deliberately makes NO database connections. Restart the staging Node.js
app after uploading the new handler. Anonymous GET / POST to the new
route should return HTTP 404 `not_found` with the probe disabled.
The real Login routes must remain HTTP 501.

**Phase B — Briefly enable one POST using a secret, only after Phase A.**
Generate a fresh 64-character random hex string LOCALLY and enter it only
in DirectAdmin's staging environment editor as
`RD_AUTH_HTTPS_PROBE_SECRET`. Set `RD_AUTH_HTTPS_PROBE_ENABLE=1`.
Also set `RD_AUTH_HTTPS_PROBE_UNTIL` to the Unix epoch seconds 10–20 minutes
in the future (and never more than one hour). Restart the staging app.
Do not store any of these secrets in GitHub, a URL/query string, any chat,
screenshots or application source code. Use one same-origin HTTPS POST
with header `X-RD-HTTPS-Probe-Secret` and **no body**. E.g. from the
school administrator's local PowerShell after generating `$secret`:
`Invoke-RestMethod -Uri 'https://ratsada.ac.th/web/rd-connect-node-test/api/migration/auth-probe' -Method POST -Headers @{'X-RD-HTTPS-Probe-Secret'=$secret}`.
Expected HTTP 200 response includes
`{"ok":true,"check":"https_auth_transaction","rollback_verified":true,"login_enabled":false,"migration_ready":false}`
(with a `roles_verified` array).
On failure (HTTP 503), STOP; don't retry until the cause is reviewed.

**Immediately after the single test**, set
`RD_AUTH_HTTPS_PROBE_ENABLE=0`, delete the secret and expiry env
variables, then restart the staging app. Check that the probe returns
HTTP 404. This feature is not a production endpoint or approval to import
real staff, student, or guardian accounts. All ten missing business-rule
triggers, stronger password hashing, hardened auth and authorization,
and migration parity must be completed before production cutover.

## Stage 7.1: Read-only prerequisites for D1 business-rule triggers

The original **schema-only** SQLite D1 export contains exactly ten
`CREATE TRIGGER` statements (guardian role, timetable insert/update
overlaps, behavior soft-delete/restore, truancy insert/delete scoring,
two push notification events, and behavior incident application).
The school MariaDB staging schema was imported without any triggers.
Before writing any MariaDB trigger DDL, run this **READ-ONLY** preflight.

Upload only these two files from the experimental branch:
- `node-hosting/package.json` → `/home/ratsadaa/rd-connect-node-stage/package.json`
- `node-hosting/scripts/check-trigger-preflight.cjs` →
  `/home/ratsadaa/rd-connect-node-stage/scripts/check-trigger-preflight.cjs`

In DirectAdmin → Setup Node.js App → Run JS Script, run
`check:trigger-preflight`. It checks the connected DB is exactly
`ratsadaa_connect`, 14 required InnoDB tables and 52 essential
columns, 3 relevant unique composite keys and the baseline of zero
installed MariaDB triggers. Only information_schema metadata is queried;
no school account/student/guardian records are read, no DDL is applied
and no Login endpoint is enabled.

Expected output: `returncode: 0`, `STEP 7.1 OK`, `READ-ONLY INVENTORY`,
`NO SCHEMA CHANGES` and `LIVE LOGIN STILL CLOSED`.
If it fails, stop before creating any database triggers and inspect
schema drift. A passed audit **does not mean all trigger semantics have
been ported**. Original D1 and the live school PWA remain unchanged.

After this read-only gate, draft MariaDB trigger migrations and
synthetic-only transaction tests as a separate reviewed step. MariaDB
DDL auto-commits; do not assume `ROLLBACK` removes a new trigger.
Timetable overlap checks also need concurrency-safe locking, and
app-level authorization / trigger ordering must be audited before
any production switch. MariaDB 10.4 should be upgraded by hosting
before production cutover.

## Stage 7.2: Review draft SQL for guardian and timetable rules (no database changes)

The original D1 schema-only SQL (not sample-memory approximations) was checked
against the MariaDB staging schema export for the following **three** triggers:
- `guardian_link_role_guard` blocks a link unless the portal account is a guardian;
- `timetable_clash_insert` blocks single-writer active timetable overlap;
- `timetable_clash_update` excludes its own row and checks the same overlap.

The draft file
`migrations/drafts/0001_guardian_timetable_10_4.sql`
contains candidate MariaDB 10.4 `SIGNAL SQLSTATE '45000'` replacements
and an explicit DO NOT EXECUTE banner. **Do not import the SQL into phpMyAdmin
or run it on the school's MariaDB staging database.** It has only been
reviewed statically, NOT executed on MariaDB.

**Why not install yet?** The D1 overlap SELECT does not prove
race-safety for two concurrent teacher schedules, and the original
guardian guard also has an update-bypass risk if an already-linked
portal account changes role. Trigger creation is DDL and implicitly
commits, so ROLLBACK does not remove a newly created trigger. Next,
test an isolated disposable database with two concurrent sessions and
review an account-role update guard before any installation.

For the current read-only stage, upload three files from the staging branch:
- `package.json`
- `scripts/check-trigger-draft.cjs`
- `migrations/drafts/0001_guardian_timetable_10_4.sql`

Use DirectAdmin → Setup Node.js App → Run JS Script →
`check:trigger-draft`. Expected `returncode: 0` and
`STEP 7.2 DRAFT OK`, `NO DATABASE ACCESS / NO DDL`,
`NOT APPROVED FOR DEPLOYMENT`. This script ONLY reads the .sql
text from disk to check essential guard clauses; it does **not**
execute SQL, connect to MariaDB or verify database syntax.

The existing `ratsadaa_connect` remains on its tested baseline of
0 triggers. Do not merge staging into main or switch the live Cloudflare
PWA yet.

## Stage 7.3: Create and verify a separate, empty MariaDB trigger laboratory

The source-derived first three trigger candidates passed **static review** in
stage 7.2. This is not permission to install SQL on the real RD CONNECT
staging DB. We need a **different** disposable MariaDB database to test
MariaDB syntax, guardian-role changes and overlapping timetable concurrent
writes. This step checks only a brand-new EMPTY database, without any SQL
DDL or actual school/student records.

### A. Create lab only in DirectAdmin (do not use phpMyAdmin SQL importer)

DirectAdmin → MySQL Management → Create New Database:
- Database *suffix*: `trgtest`, so the full database name is
  **`ratsadaa_trgtest`**.
- Create a distinct database user with a strong random password, granting
  access only to the new test database. Do not reuse the
  `ratsadaa_connect` database user or password.
- Leave this new database completely EMPTY: **0 tables, 0 views, 0 triggers**.
- If DirectAdmin creates a different full name, STOP; do not point this
  script at `ratsadaa_connect` or edit scripts to weaken the safety guard.

### B. Add separate test-only settings to the staged Node.js app

DirectAdmin → Setup Node.js App → `rd-connect-node-stage` →
Environment Variables:
- `RD_TRIGGER_LAB_DB_HOST`: same database host as the school MariaDB,
  copied privately from `RD_DB_HOST`.
- `RD_TRIGGER_LAB_DB_PORT`: normally `3306`, or same as `RD_DB_PORT`.
- `RD_TRIGGER_LAB_DB_NAME`: exactly `ratsadaa_trgtest`.
- `RD_TRIGGER_LAB_DB_USER`: the **new** test-only DB username.
- `RD_TRIGGER_LAB_DB_PASSWORD`: its **new** password.

DO NOT change any existing `RD_DB_*` variables. Never send DB passwords
through chat, commit them to GitHub or copy them into JS files.

### C. Upload and run read-only guard

From the staging GitHub branch upload only:
- `node-hosting/package.json` → `package.json`
- `node-hosting/scripts/check-trigger-lab.cjs` →
  `scripts/check-trigger-lab.cjs`

DirectAdmin → Setup Node.js App → Run JS Script →
**`check:trigger-lab`**.

Expected: `returncode: 0` and
`STEP 7.3 OK: separate empty MariaDB trigger lab is available (read-only)`.
The script strictly requires the full DB name `ratsadaa_trgtest`,
refuses `ratsadaa_connect` and nonempty lab databases, queries
only `SELECT DATABASE()` and `information_schema`, and logs no
hostnames, users or passwords. The existing app/Login, D1 and MariaDB
`ratsadaa_connect` are unchanged.

Next, create and import a **schema-only, no-data** clone into this
separate lab after explicit verification. Only then can MariaDB trigger
DDL and two-connection concurrency tests begin. MariaDB DDL is not
rolled back by `ROLLBACK`; work solely in a disposable database.

## Stage 7.4: Import the 63-table SCHEMA ONLY into the isolated trigger lab

Stage 7.3 has verified `ratsadaa_trgtest` is a separate, completely
empty, InnoDB-capable MariaDB test database using its own credentials.
This step uses a **schema-only**, corrected MariaDB export, with
63 `CREATE TABLE` statements and 119 `ALTER TABLE ... ADD CONSTRAINT`
foreign keys. It has **no INSERT, UPDATE, DELETE, DROP, CREATE TRIGGER,
CREATE USER, or production database reference to execute**.

The delivered standalone file is
`RD_CONNECT_7_4_LAB_SCHEMA_ONLY.sql` (63,730 bytes,
SHA-256 `890f2bcf97eb657503b71e8610eab3e3acf3033517ea68aa886815cdd0843ff0`).
Its source is the corrected `04_FULL_SCHEMA_CORRECTED.sql` from the
previous `RD_CONNECT_MariaDB_Warning1901_Fix_2026-10-30.zip`.
A new leading `USE \`ratsadaa_trgtest\`;` pins the import
to the disposable lab, regardless of whichever database is highlighted
in phpMyAdmin. This file was created from the locally supplied original
corrected schema; it is shared as a **conversation artifact**, not stored
within this GitHub source branch.

**Procedure:**

1. In phpMyAdmin check that `ratsadaa_trgtest` is selected and
   contains **zero tables**. Verify `ratsadaa_connect` is not selected
   for the import. The SQL contains a `USE ratsadaa_trgtest` safeguard.
2. Use phpMyAdmin → Import → select only
   `RD_CONNECT_7_4_LAB_SCHEMA_ONLY.sql`.
   Do NOT import the SQLite D1 file or SQL trigger draft from step 7.2.
3. If the import reports **any error**, STOP. DDL auto-commits;
   repeating a partial import is unsafe. Preserve the error and
   report it before proceeding.
4. After successful import, upload from `node-hosting/` to the
   existing DirectAdmin Node app:
   - `package.json` → `package.json`
   - `scripts/verify-trigger-lab-schema.cjs` →
     `scripts/verify-trigger-lab-schema.cjs`
5. Run DirectAdmin → Setup Node.js App → Run JS Script →
   `verify:trigger-lab-schema`.
   Expected `returncode: 0`, 63 tables, 119 FKs, no triggers,
   no views, end_date varchar(10), two required unique indexes, and
   **all 63 tables empty**. All checks use SELECT only and the separate
   `RD_TRIGGER_LAB_DB_*` credentials.
6. If it fails, keep the lab database isolated and preserve its state
   for investigation. Never import another schema over the existing
   school staging database.

The schema clone is meant only to make a safe sandbox for testing
triggers. Do not import real student or guardian records. No production
API becomes available because the schema is installed. The public Login
endpoints remain 501, and `/api/health` remains
`migration_not_ready`.

## Stage 7.5: Install + test the FIRST guardian-link INSERT guard in a disposable DB only

Prerequisite: `verify:trigger-lab-schema` returned code 0:
`ratsadaa_trgtest` contains 63 EMPTY tables, 119 foreign keys,
0 triggers and no real school data. This is a separate database with
separate `RD_TRIGGER_LAB_DB_*` credentials.

Only ONE trigger is installed in this stage:
`guardian_link_role_guard` (BEFORE INSERT on `guardian_student_links`).
It requires an existing portal account with `role='guardian'` and uses
MariaDB's `SIGNAL SQLSTATE '45000'` to reject a student-account link.
This is *not* the timetable migration and does *not* yet protect updates
to `guardian_student_links` or role changes in `portal_accounts`.
All later trigger work will still require proper authorization and
concurrent-write tests.

**Upload only these four new/changed files** under the existing
`/home/ratsadaa/rd-connect-node-stage` root:
- `package.json`
- `src/lab-guardian-guard.cjs`
- `scripts/install-lab-guardian-guard.cjs`
- `scripts/check-lab-guardian-guard.cjs`

The installer additionally requires the existing
`scripts/verify-trigger-lab-schema.cjs`,
`scripts/check-trigger-lab.cjs` and `scripts/check-db.cjs`.
**Do not import** any SQL file or run the old 7.2 draft in phpMyAdmin.

**A. One-time installation (DDL cannot be undone by ROLLBACK).**
In DirectAdmin → Setup Node.js App → `rd-connect-node-stage` →
Environment Variables, add:
`RD_TRIGGER_LAB_ALLOW_DDL=INSTALL_GUARDIAN_DDL_ON_TEST_DB_7_5`.
Do not change the existing `RD_DB_*` or `RD_TRIGGER_LAB_DB_*` credentials.
Run **`install:lab-guardian-guard`** in Run JS Script.

Before doing any DDL it refuses wrong database name, non-InnoDB
tables, mismatched 63-table/119-FK schema, any installed trigger, or
any existing rows in all 63 tables. This makes it impossible to
intentionally run the installer against the school's `ratsadaa_connect`
through its normal configured database connection. If it fails:
**STOP, do not retry blindly**. A DDL operation might already have
committed; inspect the *lab* trigger inventory first.
If it succeeds, expect `STEP 7.5 INSTALL OK` and exactly 1 trigger.
Then **remove** `RD_TRIGGER_LAB_ALLOW_DDL` from the environment.

**B. Synthetic-only test (ROLLBACK).**
Run `check:lab-guardian-guard`. This test confirms the installed
trigger metadata, lab schema, and initial emptiness, then inserts a
fake teacher, classroom, student, student portal and guardian portal
inside a transaction. Linking the student portal as guardian must be
rejected with SQLSTATE 45000; linking a guardian must succeed.
The entire transaction is rolled back and account/roster/link
emptiness is verified. Expect `STEP 7.5 TEST OK` and
`ROLLBACK VERIFIED`.

After this stage, `verify:trigger-lab-schema` from stage 7.4 will
**intentionally fail**, because it expects 0 triggers. Use
`check:lab-guardian-guard` for the new lab baseline of 1 trigger.
Do not install this on `ratsadaa_connect`, modify Cloudflare D1,
open a public Login API, import real school records, or merge into main.
The known guardian UPDATE and role-change bypasses must be addressed
before considering this rule production-ready.

## Stage 7.6 — Close guardian link UPDATE and account-role change bypasses (lab only)

Stage 7.5 has now passed on the actual disposable `ratsadaa_trgtest`:
the single `guardian_link_role_guard` INSERT trigger rejected student
accounts, accepted guardian accounts, and synthetic records rolled back.
The live `ratsadaa_connect` schema and Cloudflare D1 remain untouched.

This stage adds exactly **two additional triggers** on the **isolated**
MariaDB lab, for a total of **three** guardian-related triggers:

1. `guardian_link_role_guard_update`: BEFORE UPDATE on
   `guardian_student_links` verifies that the NEW guardian account role is
   actually `guardian`, preventing an existing link from being reassigned
   to a student login.
2. `guardian_account_role_guard_update`: BEFORE UPDATE on
   `portal_accounts` rejects changing `role='guardian'` to another
   value while linked students still exist. Non-role profile changes and
   changes after links are reassigned remain permitted.

**These two new rules are lab hardening only, not a complete
production-ready concurrency solution.** Simultaneous link inserts and
guardian role updates still require two-session race tests and an
atomic locking policy before importing real data.

### Files

Upload **four new/updated files** from `node-hosting/` to
`/home/ratsadaa/rd-connect-node-stage/`:

- `package.json`
- `src/lab-guardian-update-guards.cjs`
- `scripts/install-lab-guardian-update-guards.cjs`
- `scripts/check-lab-guardian-updates.cjs`

The previously uploaded `src/lab-guardian-guard.cjs` must remain in place;
**do not replace or remove it**.

The lab DB must still have 63 empty InnoDB tables, 119 foreign keys,
and **exactly 1** installed trigger from stage 7.5.

**One-time explicit DDL opt-in.** In DirectAdmin → Setup Node.js App →
Environment Variables, set:
`RD_TRIGGER_LAB_ALLOW_DDL=INSTALL_GUARDIAN_UPDATE_DDL_ON_TEST_DB_7_6`.
This is a new value; the old 7.5 value does not authorize this install.
Run `install:lab-guardian-updates` once via Run JS Script.
The installer verifies the exact lab DB name, different DB credentials,
63 empty InnoDB tables, 119 foreign keys, original trigger metadata,
and no other triggers **before** creating anything. It checks the second
and third installed trigger separately. Expected `returncode:0` and
`STEP 7.6 INSTALL OK` with exactly 3 guardian triggers.

**Immediately delete** `RD_TRIGGER_LAB_ALLOW_DDL` from the app
environment after successful installation. **Do not rerun the installer**.
DDL auto-commits, so on a partial failure there may be 2 rather than
3 triggers; stop and inspect the lab before any follow-up installation.

Run `check:lab-guardian-updates` next. This invokes MariaDB with
synthetic teacher, two students, student portal, and guardian portal
accounts, tests blocked INSERT/UPDATE student-account linking and
blocked linked-guardian role updates, plus successful authorized guardian
reassignment and unrelated profile update. Transaction `ROLLBACK`
removes all fake records, and all 63 tables are checked empty.
Expected `returncode:0`, `STEP 7.6 TEST OK` and
`ROLLBACK VERIFIED`.

The older `check:lab-guardian-guard` and
`verify:trigger-lab-schema` check scripts are now superseded for
this 3-trigger lab baseline (they expect exactly 1 or 0 trigger).
Never run the installer on the school's `ratsadaa_connect`,
never import real records, enable live Node Login, or merge this
work into `main`.

## Stage 7.7: Two-connection guardian role/link race diagnostic (lab only)

Stages 7.5–7.6 have installed exactly 3 guardian triggers in
`ratsadaa_trgtest` and verified basic single-transaction behavior.
Stage 7.7 tests a common stale-snapshot interleaving under MariaDB's
REPEATABLE READ with **two active database connections**. It deliberately
does not claim full concurrency correctness from one diagnostic.

**Important:** The test temporarily **COMMITS synthetic teacher, classroom,
two student and guardian account rows** so both database connections can
see them; it then runs concurrent *overlapping* transactions, rolls back
the attempted link, and deletes the synthetic rows by their exact IDs.
It finally verifies **all 63 lab tables are empty**. Unlike prior
pure-ROLLBACK tests, a Node/process crash during this step can leave
synthetic rows in the disposable lab. The preflight refuses to run
against any database that already contains rows; on failure or
interruption STOP, inspect the lab and do not retry or run broad DELETEs.
Never use real school identities.

The scripted scenario:
1. Read-only preflight checks `ratsadaa_trgtest`, 63 empty InnoDB
   tables, and exactly the three expected guardian triggers.
2. Seed five synthetic records (teacher, classroom, two pupils, guardian).
3. Connection B starts REPEATABLE READ and reads the guardian's old role.
4. Connection A changes the *unlinked* guardian into a student account
   linked to the second synthetic pupil and COMMITs.
5. Connection B tries to INSERT a guardian link for that account using
   the older snapshot. Record whether the trigger rejects or mistakenly
   permits it, then always ROLLBACK connection B.
6. Delete only the synthetic seed by exact IDs, validate the whole
   lab is empty and the three triggers remain.
7. Report either `STALE_SNAPSHOT_ALLOWED` (vulnerability found) or
   `INVALID_LINK_REJECTED_IN_THIS_INTERLEAVING` (one interleaving
   blocked; **not** a general proof of concurrency safety).
   
No DDL, schema migration, live Login, Push, or Cloudflare changes occur.

### Upload + DirectAdmin

Only upload these two files to the existing staged Node root:
- `node-hosting/package.json` → `package.json`
- `node-hosting/scripts/check-lab-guardian-race.cjs` →
  `scripts/check-lab-guardian-race.cjs`

The prior code in `src/lab-guardian-update-guards.cjs`,
`scripts/check-lab-guardian-updates.cjs` and
`scripts/check-trigger-lab.cjs` must remain installed.

**Remove** any old `RD_TRIGGER_LAB_ALLOW_DDL` environment setting.
Add an explicit test-only environment setting:
`RD_TRIGGER_LAB_ALLOW_RACE=RUN_LAB_GUARDIAN_RACE_7_7`.
This does NOT expose an HTTP endpoint and enables NO DDL.
From DirectAdmin → Setup Node.js App → Run JS Script, run
`check:lab-guardian-race` **once**, while no other application
is accessing the disposable trigger lab. Delete
`RD_TRIGGER_LAB_ALLOW_RACE` immediately after completion.

Expected `returncode: 0` and `STEP 7.7 DIAGNOSTIC COMPLETE`,
one of the two race findings above, and `LAB CLEANUP VERIFIED`.
Both results leave production approval **blocked**: a detected stale
snapshot calls for transaction locking fixes, while a blocked
single interleaving still needs true simultaneous race testing,
lock timeouts, isolation-level analysis and robust application-layer
authorizations. If cleanup fails, do not rerun blindly; preserve
the error and inspect only disposable lab rows.

## Stage 7.8 — Reverse two-connection guardian link/role race (disposable lab)

Stage 7.7 reported `INVALID_LINK_REJECTED_IN_THIS_INTERLEAVING` and
confirmed the committed fake seed and all lab tables were cleaned up.
That one interleaving alone does not prove absence of races.

Step 7.8 tests the **reverse timing** on isolated `ratsadaa_trgtest`.
It requires the original 3 exact guardian triggers and an EMPTY
63-table laboratory. The script uses two distinct MariaDB connections:
1. COMMIT a fake teacher, classroom, two students, and a guardian
   account, using the existing 7.7 `seed` helper.
2. Connection B starts a transaction and INSERTs a valid guardian link,
   keeping the insert uncommitted.
3. Connection A starts a second transaction and tries to UPDATE that
   guardian into a student account. The update is in flight while
   B still owns its transaction.
4. B COMMITs the guardian link, then A's UPDATE result is observed.
   A's UPDATE is ALWAYS rolled back, even if the guard unexpectedly
   allowed it. A session-only 5s InnoDB lock timeout is used.
5. Delete the exact fake seed/link IDs, verify 63 tables empty and the
   original 3 triggers still present.

A fake seed is temporarily COMMITTED, so an interrupted process can
leave harmless synthetic records in the disposable lab. On ANY failure,
stop, preserve the error, and check the lab before trying again.
Do not use student, staff, or parent records from the live system.

**Upload exactly two changed/new files from `node-hosting/`:**
- `package.json` → `/home/ratsadaa/rd-connect-node-stage/package.json`
- `scripts/check-lab-guardian-reverse-race.cjs` →
  `/home/ratsadaa/rd-connect-node-stage/scripts/check-lab-guardian-reverse-race.cjs`

The existing `scripts/check-lab-guardian-race.cjs`, `src/lab-guardian-update-guards.cjs`,
`scripts/check-lab-guardian-updates.cjs`, and other prior dependencies
must remain installed. **Do not import SQL or change triggers.**

Remove any old `RD_TRIGGER_LAB_ALLOW_RACE` value. Then add this
different, explicit environment setting in DirectAdmin:
`RD_TRIGGER_LAB_ALLOW_RACE=RUN_LAB_GUARDIAN_REVERSE_RACE_7_8`.
Also confirm `RD_TRIGGER_LAB_ALLOW_DDL` is ABSENT.

Via Setup Node.js App → Run JS Script execute
`check:lab-guardian-reverse-race` **once**. Expected:
`returncode: 0`, `STEP 7.8 DIAGNOSTIC COMPLETE`,
`LAB CLEANUP VERIFIED`, and `PRODUCTION BLOCKED`.

The outcome line reports one of:
- `LINKED_ROLE_CHANGE_REJECTED_IN_THIS_INTERLEAVING`:
  observed guard rejected a role update in the tested order.
- `ROLE_UPDATE_ALLOWED — POTENTIAL CONCURRENCY BYPASS DETECTED`:
  the guard allowed a role update, but the test rolled it back.

Either outcome is a *diagnostic*, not approval to operate the Node
service with real school accounts. A race finding must be fixed and
then re-tested, while even two passing race cases don't prove all
possible concurrency schedules. **Remove**
`RD_TRIGGER_LAB_ALLOW_RACE` promptly when finished.
`ratsadaa_connect`, live D1 and public Login APIs remain untouched.

## Stage 7.9 — MariaDB timetable overlap triggers, isolated lab only

**Prerequisite:** Stage 7.8 passed. The database `ratsadaa_trgtest`
must still have **63 empty tables, 119 foreign keys, exactly 3 guardian
triggers and zero timetable triggers**. This stage copies the *original
D1* clash predicates to two MariaDB 10.4 BEFORE triggers using
`SIGNAL SQLSTATE '45000'`.

- `timetable_clash_insert` rejects an active lesson sharing an inclusive
  period with another active lesson in the same classroom OR by the same
  teacher on the same weekday.
- `timetable_clash_update` checks the same condition when a lesson
  changes, excluding its own row by `t.id <> OLD.id`. MariaDB does not
  support SQLite's `UPDATE OF ...` syntax, so its trigger runs on all
  updates and the predicate decides whether to block.

The existing generated timetable UNIQUE index also applies; the
original D1 and MariaDB business rules are not generally identical
without comprehensive constraint tests. **These triggers do not yet
guarantee race-safety for simultaneous class/teacher writes**; that
will require two-connection tests and properly serialized locking.

Only upload these 4 new/updated files to
`/home/ratsadaa/rd-connect-node-stage/`:
- `node-hosting/package.json` → `package.json`
- `node-hosting/src/lab-timetable-guards.cjs` →
  `src/lab-timetable-guards.cjs`
- `node-hosting/scripts/install-lab-timetable-guards.cjs` →
  `scripts/install-lab-timetable-guards.cjs`
- `node-hosting/scripts/check-lab-timetable-guards.cjs` →
  `scripts/check-lab-timetable-guards.cjs`

Keep previously installed guardian test modules intact.
**Do not import the older 7.2 SQL draft into phpMyAdmin.**
Confirm old `RD_TRIGGER_LAB_ALLOW_RACE` has been removed.

### A. Opt-in once to DDL on LAB ONLY

DirectAdmin → Setup Node.js App → Environment Variables:
`RD_TRIGGER_LAB_ALLOW_DDL=INSTALL_TIMETABLE_DDL_ON_TEST_DB_7_9`.
Existing `RD_TRIGGER_LAB_DB_*` credentials point ONLY to the
disposable `ratsadaa_trgtest`. NEVER modify `RD_DB_*` or import
the SQL into `ratsadaa_connect`.

Run `install:lab-timetable-guards` using Run JS Script **one time**.
Installer verifies exact lab database name, 63 empty InnoDB tables,
119 FKs, 0 views, original 3 guardian trigger definitions and no other
triggers. It creates exactly 2 timetable triggers, checking the
total count after each, then returns:
`returncode: 0`, `STEP 7.9 INSTALL OK`,
`installed_triggers: 5` and `timetable_triggers: 2`.

**Immediately remove** `RD_TRIGGER_LAB_ALLOW_DDL` after installation.
If any error occurs STOP: one trigger may have been committed even if
the next failed. Never blindly rerun DDL; inspect the lab first.

### B. Test with fake data and ROLLBACK

Run `check:lab-timetable-guards`.
This tests fake teachers and classrooms inside a single transaction:
same-room overlap rejected, same-teacher overlap rejected, adjacent
period allowed, different weekday allowed, inactive overlap allowed,
active toggle to clash rejected, unchanged-record edit allowed,
period update clash rejected, weekday update clash rejected.
The transaction is rolled back regardless of success/failure, then
all 63 tables are checked empty and the five triggers validated.

Expect `returncode: 0`, `STEP 7.9 TEST OK`,
`ROLLBACK VERIFIED` and `PRODUCTION BLOCKED`.

The trigger laboratory should now contain **5 triggers (3 extra
guardian guards + 2 original timetable rules)**; the school's staging
`ratsadaa_connect` remains on **0** business-rule triggers.
Live Cloudflare D1, real student data and public Node Login must not
change. Period-end validation and concurrent timetable writes remain
outstanding. If the test fails, share the safe error code from
DirectAdmin; do not rerun the installer.

## Stage 7.10: Two-connection timetable overlap diagnostic — disposable MariaDB lab ONLY

**Precondition:** Stage 7.9 installation + rollback test returned code 0.
The test database `ratsadaa_trgtest` contains 63 EMPTY InnoDB
tables, 119 foreign keys, exactly FIVE previously installed triggers
(3 guardian, 2 timetable), and no actual staff/student records.
This stage does NOT create, alter or drop triggers.

**What it tests:** two MariaDB connections each start separate active
transactions. A INSERTs a synthetic active lesson and does NOT commit;
B INSERTs a time-overlapping lesson before A finishes. Test cases:
1. SAME CLASSROOM, DIFFERENT TEACHERS, different start periods but
   overlapping inclusive period ranges (A 1–2, B 2–3).
2. SAME TEACHER, DIFFERENT CLASSROOMS, overlapping ranges
   (A 4–5, B 5–6).

The script tests whether B is rejected by the timetable trigger,
temporarily accepted due to uncommitted A, or blocked by the DB lock.
B and A's lesson transactions are **ALWAYS ROLLED BACK** even if
an overlap is accepted. The test never commits an invalid timetable.
Results are diagnostic, not production approval.

Unlike the 7.9 rollback-only test, **teacher/classroom fixture records
are temporarily COMMITTED** so both connections can see FK parents.
Cleanup DELETEs **only those exact synthetic fixture IDs**, then
verifies all 63 tables empty and all 5 triggers still installed.
A process crash or interrupted cleanup can strand synthetic fixtures:
STOP and inspect the isolated lab before trying again; do not run
blind retries or broad DELETEs. No real data, public Login, Cloudflare
D1 or `ratsadaa_connect` should be used.

### Upload two files

From the staged GitHub branch, copy into
`/home/ratsadaa/rd-connect-node-stage`:
- `node-hosting/package.json` → `package.json`
- `node-hosting/scripts/check-lab-timetable-race.cjs`
  → `scripts/check-lab-timetable-race.cjs`

Leave existing `src/lab-timetable-guards.cjs`,
`scripts/check-lab-guardian-updates.cjs` and
`scripts/check-trigger-lab.cjs` intact.

In DirectAdmin → Setup Node.js App → Environment Variables:
1. Remove any older `RD_TRIGGER_LAB_ALLOW_DDL` variable.
2. Set `RD_TRIGGER_LAB_ALLOW_RACE=RUN_LAB_TIMETABLE_RACE_7_10`
   temporarily. This enables a single diagnostic script only;
   there is **no** database DDL or public HTTP endpoint.

Run `check:lab-timetable-race` **ONCE** from Run JS Script.
Expect `returncode: 0`, `STEP 7.10 DIAGNOSTIC COMPLETE`,
`LAB CLEANUP VERIFIED` and `PRODUCTION BLOCKED`.
Possible outcomes:
- `OVERLAP_ACCEPTED_WHILE_OTHER_TRANSACTION_OPEN`:
  a race weakness was observed on the tested case(s), but the test
  rolled back both lessons.
- `NO_OVERLAP_ACCEPTED_IN_THESE_CASES`:
  no overlap was accepted in these interleavings. This does **not**
  establish general concurrency safety.

The `LAB STATUS` lists `same_room` and `same_teacher` scenarios
and each second-insert result: `OVERLAP_ACCEPTED`,
`TRIGGER_REJECTED`, `LOCK_WAIT_TIMEOUT` or `DEADLOCK`.
InnoDB session lock wait is bounded to 4 seconds; deadlock/timeout
are reported as diagnostics, not as confirmed business-rule rejections.

**Remove `RD_TRIGGER_LAB_ALLOW_RACE` immediately after the test**.
Never rerun if a test fails or if `LAB CLEANUP VERIFIED` is absent.
Next work: design concurrency-safe timetable write coordination and
period-range validation. Do not copy these race-prone triggers directly
into school `ratsadaa_connect`.

## Stage 7.11 — Validate MariaDB advisory lock coordination and period ranges (NO DATA WRITES)

Stage 7.10 ran two real concurrent timetable INSERT attempts in the
isolated `ratsadaa_trgtest`, returning `LOCK_WAIT_TIMEOUT` on
**both** same-room and same-teacher variants. Neither INSERT was accepted
during the test, but neither failure was a direct timetable business
rule rejection. The fixture was deleted, both transactions rolled
back, 63 tables empty, 5 test triggers remained.

**Stage 7.11 tests a proposed coordination mechanism**, not a
production-ready API. MariaDB's
`GET_LOCK(name, timeout)` and `RELEASE_LOCK(name)` are
*named, session-scoped advisory locks*, independent of transaction
COMMIT/ROLLBACK. They can coordinate application callers that
**all agree on the same names**, but do not prevent a bypassing
writer from inserting directly. Per the MariaDB documentation, these
locks must be explicitly released before a pooled connection is
returned; they are not automatically released at COMMIT.

The new `src/timetable-write-coordination.cjs` defines:
- strict validation: day 1–7, start period 1–10,
  inclusive end period from start to 10, positive integer teacher
  and classroom IDs, active flag 0 or 1.
- `overlaps()` with inclusive periods for same teacher OR room
  on same weekday, active schedules only.
- stable, lexicographically sorted, DB-namespaced lock names
  for each teacher/day and classroom/day, which reduces
  cross-resource deadlock risk for cooperating writers.
- `acquireNamedLocks` / `releaseNamedLocks` including cleanup
  after failed partial acquisition; conflicting GET_LOCK requests
  return busy, not timetable overlap. Lock-release errors must not
  be ignored and pooled connections must be discarded on failure.
- `classifyTimetableDbError` keeps
  `TIMETABLE_OVERLAP` distinct from InnoDB 1205 (lock timeout)
  and 1213 (deadlock). Future retries must start a new transaction,
  use a bounded policy and recheck business constraints.

**No production timetable code calls these functions yet.**
An important next step is to wrap every INSERT, UPDATE, DELETE,
and multi-row timetable write in the new lock protocol, holding
the connection and locks across the entire transaction until
successful COMMIT or a full ROLLBACK. A lock-only test cannot
certify the safety of future concurrent writes.

### Upload and test with DirectAdmin

Download the staging GitHub branch and upload **three** files from
`node-hosting/` into the existing test Node app
`/home/ratsadaa/rd-connect-node-stage/`:

1. `package.json` → `package.json`
2. `src/timetable-write-coordination.cjs` →
   `src/timetable-write-coordination.cjs`
3. `scripts/check-lab-timetable-locks.cjs` →
   `scripts/check-lab-timetable-locks.cjs`

The script uses ONLY `RD_TRIGGER_LAB_DB_*` credentials, refuses
`ratsadaa_connect`, checks exactly five known triggers and all
63 tables empty. It opens two separate MariaDB connections and
acquires/releases session-level named locks for fake, randomly chosen
teacher/room IDs **without INSERT, UPDATE, DELETE or DDL**.
It verifies:
- same-teacher and same-room weekday locks exclude the other session;
- a different weekday remains independently accessible;
- once locks are released, the second session can acquire them;
- invalid day/start/end period examples are rejected offline;
- all locks are released, 63 tables still empty, 5 triggers unchanged.

In DirectAdmin → Setup Node.js App → Environment Variables:
remove any old `RD_TRIGGER_LAB_ALLOW_DDL` and
`RD_TRIGGER_LAB_ALLOW_RACE` entries. Add **temporarily**
`RD_TRIGGER_LAB_ALLOW_LOCK=RUN_LAB_TIMETABLE_LOCK_7_11`.
This flag enables only this manual diagnostic; it never enables a
public API. Run `check:lab-timetable-locks` once through
Run JS Script. Expect `returncode: 0`,
`STEP 7.11 LOCKS OK`, `PERIOD VALIDATION OK`,
`LAB DATA UNCHANGED`, and `NOT INTEGRATED`.
Remove `RD_TRIGGER_LAB_ALLOW_LOCK` afterward.

If it fails, do not weaken test DB isolation or reuse school DB
credentials; inspect the reported fail-closed category. This stage
does not create a trigger, open Login or migrate real school data.
The original Cloudflare D1 and Node staging `ratsadaa_connect`
are unchanged.

## Stage 7.12: Real coordinated INSERT transactions on a disposable trigger lab

Stage 7.11 passed: per-classroom/day and per-teacher/day
`GET_LOCK` calls were exclusive, different weekdays did not
interfere, and all advisory locks were released. The old stage 7.10
concurrent raw timetable INSERTs failed with lock wait timeouts, NOT
`TIMETABLE_OVERLAP` business rule errors. **This stage integrates the
coordination prototype with a real MariaDB INSERT transaction** on the
isolated `ratsadaa_trgtest`.

### Algorithm to test

The new `src/timetable-locked-insert.cjs` implements a prototype
`coordinatedInsert` function:
1. Validate teacher, classroom, weekday, period (1–10), end period
   (start–10), active and non-empty subject *before* opening a
   transaction or acquiring locks.
2. GET_LOCK for both stable names (one teacher/day, one room/day),
   sorted globally to avoid inconsistent lock order.
3. BEGIN a new transaction **after** acquiring both locks.
4. SELECT existing active timetable overlaps in the same weekday,
   teacher or room, with inclusive period ranges.
5. If an overlap exists: return a distinct
   `TIMETABLE_OVERLAP` error after ROLLBACK.
   Otherwise INSERT a row and COMMIT.
6. RELEASE_LOCK **only after COMMIT/ROLLBACK**, even after an exception.

The new diagnostic creates **fake** teachers and classrooms and
temporarily **COMMITs** them so two MariaDB connections can see them.
It tests BOTH:
- same room with different teachers: first INSERT (periods 1–2)
  holds the lock, second session reports BUSY (no SQL write);
  once first COMMITs and releases, the second session's overlapping
  period 2–3 is refused as a real business-rule overlap.
- same teacher with two different classrooms: periods 4–5 and 5–6,
  with the same expected BUSY-then-OVERLAP sequence.
- a non-overlapping adjacent lesson (period 3) is committed
  successfully after the first period 1–2 lesson.

The test thus commits **three synthetic timetable rows** (2 base
lessons and one adjacent). The cleanup explicitly deletes
these rows by **fake classroom IDs**, then the two fake classrooms
and fake teachers by their exact IDs. Finally the script checks
that **all 63 test tables are empty** and that all five installed
triggers remain. **It must not run while another process is using
the lab.** A sudden process interruption can leave synthetic
fixture rows or lessons. If cleanup fails or is not reported,
STOP and inspect the isolated lab before retrying, and do NOT
run mass DELETE queries.

The test **does not** install triggers, modify the staging
`ratsadaa_connect`, change Cloudflare D1, touch actual teacher or
student accounts, or open public Login routes. No production route
uses `coordinatedInsert` yet. **All timetable writers including
UPDATE, DELETE and bulk operations must follow the same lock
protocol**; the current step is NOT production-ready.

### DirectAdmin procedure

Download the staging branch and upload **three files** from
`node-hosting/` to
`/home/ratsadaa/rd-connect-node-stage/`:
- `package.json`
- `src/timetable-locked-insert.cjs`
- `scripts/check-lab-timetable-locked-inserts.cjs`

Keep existing scripts and `src/timetable-write-coordination.cjs`.
Confirm prior test reports `63 empty tables`, `5 triggers`,
and remove old `RD_TRIGGER_LAB_ALLOW_LOCK`,
`RD_TRIGGER_LAB_ALLOW_RACE`, and `RD_TRIGGER_LAB_ALLOW_DDL`
from environment variables. Add an explicit one-time test flag:

`RD_TRIGGER_LAB_ALLOW_WRITE=RUN_LAB_TIMETABLE_WRITE_7_12`

Run from DirectAdmin → Setup Node.js App → Run JS Script:

`check:lab-timetable-locked-inserts`

Expected `returncode: 0`, `STEP 7.12 LOCKED INSERT OK`,
`SAME ROOM + SAME TEACHER`, `ADJACENT PERIOD ALLOWED`,
`LAB CLEANUP VERIFIED`, `NOT PRODUCTION READY`.
The result JSON contains two cases with
`blocked_before_commit: true` and
`retry_after_commit: "overlap"`, plus
`committed_test_rows: 3`, `cleanup_verified: true`.

**Immediately remove** `RD_TRIGGER_LAB_ALLOW_WRITE` after
the diagnostic. If the script fails, do not retry blindly, because
this step creates temporary *committed* synthetic timetable rows.
Preserve error category (never share database credentials) and
inspect the lab before the next test.

## Stage 7.13 — Coordinated timetable UPDATE + DELETE lab integration

Stage 7.12 passed on actual MariaDB: both concurrent same-room and
same-teacher INSERT attempts returned BUSY while the first writer
held named locks, then returned TIMETABLE_OVERLAP after COMMIT; a
nonoverlapping adjacent period was allowed. Three committed
synthetic timetable rows were removed and all 63 tables were empty.
The test-only database `ratsadaa_trgtest` contains exactly five triggers.

Stage 7.13 extends the same stable advisory-lock protocol for
**UPDATE and DELETE**, and adds **stale-row detection**. Only the
separate disposable test DB may be used; the live Cloudflare D1,
Node staging `ratsadaa_connect`, public Login and real school
records are never changed.

### Prototype behavior

New `src/timetable-locked-update-delete.cjs` functions:
- `coordinatedUpdate(conn, dbName, id, nextLesson)`: read old
  row, validate new day/period/teacher/classroom/subject, acquire
  **the union of original and target locks** in global sorted order,
  start transaction, re-read the row `FOR UPDATE`, compare original
  fields to detect a concurrent change, check target overlaps
  **excluding the same timetable id**, UPDATE, COMMIT then release
  all named locks. On error, ROLLBACK then release.
- `coordinatedDelete(conn, dbName, id)`: read old row,
  lock its original classroom/day and teacher/day keys, begin
  transaction, re-read `FOR UPDATE`, verify row unchanged,
  DELETE, COMMIT then release.
- A stale observation returns `lab_timetable_stale_snapshot`.
  A conflicting target returns the same business error
  `TIMETABLE_OVERLAP` as INSERT; a held key returns
  `lab_named_lock_busy` (temporary contention, not overlap).
- These are **lab prototypes**, not integrated into any API.
  A future production system must enforce the lock protocol for
  all writers, including bulk changes, and discard pooled
  connections when rollback or lock release state is uncertain.

The integration script:
1. Checks exact test DB identity, **all 63 tables empty**, exactly
   five known triggers, and two distinct MariaDB connections.
2. Temporarily COMMITS **two fake teachers and two classrooms**.
   Creates synthetic timetable rows through the coordinated INSERT.
3. Moves a timetable from old classroom/teacher to different
   classroom/teacher: a peer INSERT to old **and new** resource
   returns BUSY while update holds locks. After update COMMIT,
   original slot is available, and new overlapping slot returns
   TIMETABLE_OVERLAP.
4. Rejects a move into an already occupied period, preserving
   the original timetable row.
5. Forces a concurrent update between old row observation and
   lock acquisition, verifying the stale snapshot is refused
   rather than silently overwriting the peer's timetable.
6. DELETEs the moved lesson: while DELETE holds the original
   resource lock, a peer cannot write that slot. After COMMIT,
   the peer can insert into the freed slot.
7. Deletes only **synthetic fixture classroom/teacher IDs and all
   their synthetic timetable rows**, verifies every one of the
   63 lab tables empty, and confirms exactly five triggers remain.

Unlike a pure ROLLBACK test, this temporarily COMMITS synthetic
fixtures and lessons. **If the script stops abruptly or fails
to print LAB CLEANUP VERIFIED, do NOT rerun.** Inspect the disposable
lab for any leftover synthetic records first; never use broad
unscoped DELETE/TRUNCATE statements.

### DirectAdmin

Download the latest plan/node24-mariadb-directadmin branch.
Upload **three files** from `node-hosting/` to
`/home/ratsadaa/rd-connect-node-stage/`:
- `package.json`
- `src/timetable-locked-update-delete.cjs`
- `scripts/check-lab-timetable-locked-updates.cjs`

Previously deployed `src/timetable-locked-insert.cjs`,
`src/timetable-write-coordination.cjs`, and
`scripts/check-lab-timetable-locked-inserts.cjs` stay in place.

In DirectAdmin → Setup Node.js App → Environment Variables,
remove old flags `RD_TRIGGER_LAB_ALLOW_LOCK`,
`RD_TRIGGER_LAB_ALLOW_RACE`, `RD_TRIGGER_LAB_ALLOW_DDL`.
Set **only** this new temporary opt-in:
`RD_TRIGGER_LAB_ALLOW_WRITE=RUN_LAB_TIMETABLE_UPDATE_DELETE_7_13`.
No real database credentials should be changed or disclosed.

Run **`check:lab-timetable-locked-updates`** via Run JS Script.
Expected `returncode: 0`:
`STEP 7.13 LOCKED UPDATE/DELETE OK`,
`UPDATE: old/new slots busy`,
`DELETE: old slot busy`,
`LAB CLEANUP VERIFIED`, `NOT PRODUCTION READY`.

The JSON report has `old_and_new_locks_verified:true`,
`overlap_update_rejected:true`,
`stale_snapshot_update_rejected:true`,
`delete_lock_verified:true`, `deleted_slot_reusable:true`,
`cleanup_verified:true`.

**Immediately remove** `RD_TRIGGER_LAB_ALLOW_WRITE` after
the test and **do not blindly rerun** on failure. No triggers are
installed/modified here. Continued work includes bounded retry,
safe pool connection lifecycle, bulk changes and API integration;
do not merge this into main or enable public Node Login.

## Stage 7.14 — Safe timetable retry policy + connection lifecycle lab check

**Prerequisite:** Stage 7.13 passed on MariaDB. The isolated lab
`ratsadaa_trgtest` has 63 EMPTY tables, 119 FKs and exactly five
verified triggers; all synthetic timetable rows were deleted.

The shared timetable coordination helpers now include a prototype
`src/timetable-safe-retry.cjs`:
- maximum **three** attempts (configurable only 1–3), bounded delay,
  and **a new pool checkout for each attempt**. The database driver may
  return the same physical connection after proper cleanup; this is
  not a promise of a new TCP connection every time.
- Only transient `lab_named_lock_busy`, InnoDB 1205 lock timeout, or
  1213 deadlock may be retried, **after** the application writer has
  completed its ROLLBACK and released its advisory locks.
- **No retry** for `TIMETABLE_OVERLAP`, stale update snapshots,
  validation errors, unknown COMMIT state, or other SQL errors.
- A failure to ROLLBACK or RELEASE_LOCK, network connection loss, or
  uncertain pooled connection state marks it UNSAFE and the connection
  is destroyed rather than returned to the pool.
- Exhaustion returns `lab_timetable_retry_exhausted`; callers must
  show temporary contention rather than misreporting a schedule clash.
- The retry function is **not integrated into any public API** and
  must be used ONLY with an operation that has safely rolled back and
  released all locks before rejecting. Passing arbitrary SQL or an
  operation with unknown commit state invalidates this guarantee.
  Operations already committed must never be replayed.

### Stage 7.14 MariaDB diagnostic — NO DATA WRITES

The DirectAdmin test is intentionally **read-only in table data**.
It uses MariaDB GET_LOCK / RELEASE_LOCK on random *synthetic*
classroom/day and teacher/day key names, through two connections:
1. One connection holds the two locks. Another connection first
   reports BUSY; the test releases the locks and the retry succeeds on
   its second attempt with a fresh **pool checkout**.
2. Hold locks again for all three permitted retries. Verify
   `lab_timetable_retry_exhausted` after precisely 3 attempts,
   and cleanly release all named locks.
3. Synthesize a business-level `TIMETABLE_OVERLAP` error and verify
   it is **not** retried (one attempt only).
4. Check no remaining `IS_USED_LOCK` owners, all 63 tables empty and
   all five original triggers untouched.

It runs no INSERT, UPDATE, DELETE, CREATE, ALTER or DROP, uses no
student/staff data, does not enable HTTP Login/Push and must not be
pointed at `ratsadaa_connect`.

Upload these **four** files from the latest experimental
`node-hosting/` to the existing
`/home/ratsadaa/rd-connect-node-stage/`:
- `package.json` → `package.json`
- `src/timetable-write-coordination.cjs` →
  `src/timetable-write-coordination.cjs` (improved unsafe lock
  release error classification)
- `src/timetable-safe-retry.cjs` → `src/timetable-safe-retry.cjs`
- `scripts/check-lab-timetable-retries.cjs` →
  `scripts/check-lab-timetable-retries.cjs`

In DirectAdmin → Setup Node.js App → Environment Variables, remove
old `RD_TRIGGER_LAB_ALLOW_WRITE`,
`RD_TRIGGER_LAB_ALLOW_DDL`,
`RD_TRIGGER_LAB_ALLOW_RACE` and
`RD_TRIGGER_LAB_ALLOW_LOCK` if present. Add:
`RD_TRIGGER_LAB_ALLOW_RETRY=RUN_LAB_TIMETABLE_RETRY_7_14`.
Run **`check:lab-timetable-retries`** via Run JS Script.

Expected `returncode: 0` and:
`STEP 7.14 RETRY OK`,
`BOUNDED RETRY OK`,
`BUSINESS ERROR OK`,
`LAB UNCHANGED`.
The JSON should include `busy_then_retry_succeeded:true`,
`successful_attempts:2`,
`busy_exhausted_after:3`,
`overlap_attempts:1`, and
`named_locks_released:true`.

Remove `RD_TRIGGER_LAB_ALLOW_RETRY` immediately after the test.
On failure, preserve the error category and investigate lock state.
Do not weaken lab guardrails or change production/staging database
credentials. This test validates one bounded retry protocol, not
end-to-end API readiness. Before deployment: integrate **all**
timetable writers, transaction/pool lifecycle across endpoints,
idempotency and bulk changes, authorization, and user-facing HTTP
responses. The original RD CONNECT Cloudflare D1 and
`ratsadaa_connect` remain unchanged.

## Stage 7.15 — OFFLINE timetable authorization and HTTP error contracts

Stage 7.14 passed on the isolated MariaDB `ratsadaa_trgtest`:
one busy lock was retried and succeeded on the second pool checkout,
permanently busy lock stopped at three attempts, `TIMETABLE_OVERLAP`
was not retried, all named locks were released, **63 tables stayed
empty** and **5 original lab triggers stayed installed**.

This stage is deliberately **offline-only**: no SQL connection,
HTTP listener, public endpoints, schema changes, fake fixture rows
or new environment flags. All existing public API requests, including
`/api/timetable`, must continue responding
`501 endpoint_not_migrated` through `src/http-handler.cjs`.

Added `src/timetable-offline-api-contract.cjs`:
- A future API must supply **trusted server-authenticated** staff
  identity; never trust role or teacher ID from HTTP request body,
  query, cookie, or arbitrary headers. This module does **not**
  authenticate sessions itself.
- Only an ACTIVE `teacher` role in staff area may INSERT a timetable
  for their own ID, and only edit/delete an existing timetable row
  with matching `teacher_user_id` verified through a DB read.
  Default-deny admin and generic staff *write* permissions until an
  explicit authorization policy has been designed and approved.
  A subject teacher also assigned to student affairs can use their
  standard authenticated teacher account; student and guardian
  portal users cannot write timetables.
- The client must not override `teacher_user_id`. Full timetable
  period/weekday/subject validation is completed before mutation.
- Public-safe response mapping (no SQL/password/token/internal errors,
  no CORS, `Cache-Control: no-store`):
  - 400 invalid request; 401 unauthenticated; 403 forbidden;
    404 missing timetable; 405 unsupported method;
  - 409 actual `TIMETABLE_OVERLAP` or stale-row conflict;
  - 503 transient busy/lock/deadlock or exhausted retries with
    `Retry-After: 1`;
  - 503 generic `service_unavailable` for unknown database errors
    and uncertain connection state;
  - 201 INSERT success, 200 UPDATE success, 204 DELETE success.
- These mapping functions are internal prototypes. They are **not**
  HTTP route handlers and are not wired into `app.js` or public
  `src/http-handler.cjs`. A future endpoint needs existing
  authentication/session lookup, authorization, body parsing and
  size limits, DB owner read, authorization on every operation,
  safe pooled connection lifecycle, CSRF/origin assessment for
  selected authentication transport, and tests.

### Upload and execute — NO environment flag required

Download the latest experimental branch. Upload exactly **three**
files from `node-hosting/` to
`/home/ratsadaa/rd-connect-node-stage/`:

- `package.json` → `package.json`
- `src/timetable-offline-api-contract.cjs` →
  `src/timetable-offline-api-contract.cjs`
- `scripts/check-lab-timetable-http-contract.cjs` →
  `scripts/check-lab-timetable-http-contract.cjs`

Keep the previous auth and timetable modules installed. Confirm
`RD_TRIGGER_LAB_ALLOW_RETRY` and previous write/DDL/lock/race opt-in
flags are removed. **Do not change any DB credentials or add an
environment flag for stage 7.15**.

In DirectAdmin → Setup Node.js App → Run JS Script, run
`check:lab-timetable-http-contract`. It checks synthetic trusted
teacher identities, authorization denials, safe response mappings
and calls the existing in-process public handler to ensure that
timetable routes still report `501 endpoint_not_migrated`.
It does NOT send requests over the network or connect to MariaDB.

Expected `returncode:0` with:
- `STEP 7.15 OFFLINE API CONTRACT OK`
- `AUTHORIZATION: 12 negative cases denied`
- `HTTP RESPONSES: 400/401/403/404/409/503`
- `PUBLIC API CLOSED`
- `NO DB ACCESS`

If it fails, do not enable public APIs to make tests pass;
report its safe error category, inspect uploaded file versions
and the unchanged `http-handler.cjs`. Nothing in this stage
authorizes copying these prototypes into `ratsadaa_connect`,
enabling authentication on the public Node site, importing real
students or merging the experimental branch into `main`.

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

## One-command staged verification (recommended)

To avoid two separate test runs after every API change, upload one
**reviewed batch** of files from the experimental `node-hosting/`
branch to the isolated DirectAdmin test app and select Run JS Script:

```text
check:full-staging
```

This executes `check:all-staging` (the existing 11 grouped offline,
synthetic auth/guardian/student, MariaDB rollback and NO-GO checks)
**followed automatically** by `check:api-parity` (41+ representative
Worker route/method contracts and public 501/503 gate). Expected
combined exit is **0** when the tests pass, despite the nested
API audit's deliberately expected exit **2** and the unchanged
production **NO_GO** status. Temporary rehearsal/import flags are
forbidden; the command does not perform a D1 import or send real Push.

See [ONE_COMMAND_STAGING.md](ONE_COMMAND_STAGING.md) for
results, safe failure behavior and scope limitations. From now on,
bundle multiple related private API changes before uploading and
running this single command.
