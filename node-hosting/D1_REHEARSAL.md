# RD CONNECT — D1 → MariaDB, rollback-only rehearsal (Stage 12)

**Status: EXPERIMENTAL / NO_GO.** Keep the existing Cloudflare Worker/D1
and PWA unchanged. This is a private, opt-in **synthetic/sanitized data**
rehearsal for the existing *empty* school staging database,
`ratsadaa_connect`. It is NOT a production importer, not a release
approval, and it does NOT enable any HTTP API, Push or background job.

## What is already present

- `migration/export-d1-sql-to-jsonl.py`: trusted D1 SQL → PRIVATE JSONL
  and a 63-table SHA-256/count manifest on a trusted local machine.
- `migration/manifest-planner.cjs`: table/column/FK dependency analysis.
- `scripts/check-d1-migration-plan.cjs`: read-only target check.
- `migration/reconcile.cjs`: row counts + 119 FK orphan checks.

## New rehearsal (not part of the normal staging command)

`scripts/check-d1-rollback-rehearsal.cjs` + the
`migration/rollback-rehearsal.cjs` helper:

1. Disabled by default (exit 2), without opening a database connection.
2. Requires explicit `RD_D1_REHEARSAL_CONFIRM=RUN_SYNTHETIC_D1_ROLLBACK_ONLY`,
   `RD_DB_NAME=ratsadaa_connect`, and `RD_D1_MANIFEST_FILE` pointing
   to a private `manifest.json` **outside any Git repository and public web root**.
   Existing `RD_DB_*` credentials must have access **only** to this
   disposable, empty staging DB. Never put DB passwords into files or chat.
3. Refuses any `RD_TRIGGER_LAB_ALLOW_*`, `RD_MIGRATION_ALLOW_IMPORT`, or
   `RD_ENABLE_SCHOOL_WRITES` flag.
4. Validates ALL JSONL files against the manifest (SHA-256 and newline
   counts) before any database connection, then checks source columns
   against all 63 empty InnoDB tables, 119 FKs, zero triggers,
   generated-column mismatch and FK dependency cycles.
5. Starts one MariaDB transaction, uses prepared `INSERT` statements
   (up to 25 rows per batch) in dependency order, and verifies counts and
   FK orphans **inside** the uncommitted transaction.
6. Calls `ROLLBACK` **unconditionally**, including when an error is
   detected; re-checks that all 63 tables are empty. No `COMMIT`,
   `SET FOREIGN_KEY_CHECKS=0`, SQL DDL, actual Web Push or live D1
   connection is present.

**Important:** InnoDB `AUTO_INCREMENT` counters may still advance
despite rollback. This is why the rehearsal MUST target a disposable,
isolated staging database, never production or a database with records.

## Use only after preparing a private synthetic fixture

Do not upload actual students' passwords, national IDs, guardian links,
behavior data or other personal records to GitHub, ChatGPT, or a public
web directory. For the first trial use a **sanitized fixture**, handled
on an access-controlled machine and transferred securely to a private
path outside `public_html`. The source manifest records 63 tables.
Do NOT run this against a populated staging or school database.

On the test Node app `/home/ratsadaa/rd-connect-node-stage/`:

- First run `npm run check:all-staging`. Its current 11-step result
  must remain green and the release test **NO_GO**.
- Without additional environment settings, `npm run check:d1-rehearsal`
  returns exit 2, `D1 REHEARSAL DISABLED`, with no DB connection.
- Only for an approved private **synthetic** rehearsal, configure the
  two temporary variables below through DirectAdmin's private
  environment editor (not via GitHub):

```text
RD_D1_MANIFEST_FILE=/private/non-public/path/manifest.json
RD_D1_REHEARSAL_CONFIRM=RUN_SYNTHETIC_D1_ROLLBACK_ONLY
```

- Run `check:d1-rehearsal` under **Run JS Script**. Expected success:
  exit 0, `D1 STAGING REHEARSAL PASS`, `ROLLBACK VERIFIED`,
  `PUBLIC API CLOSED`, `RELEASE NO_GO`.
- Remove both temporary variables immediately after rehearsal.
  Any failure, incomplete output, or missing rollback confirmation means
  **STOP**: inspect database state before doing anything else. Do not
  bypass preflight or repeat automatically.

## Known blockers before migration of real records

- Source/target column types, generated column mappings, SQLite integer
  precision, date/time and binary conversions require additional review.
  Invalid conversions fail closed and roll back.
- Cross-table FK cycles and row-level/self-references are **not**
  automatically bypassed; a dedicated audited import design is required.
- A matching row count/FK check is not enough. Record-level identity
  and hashes, temporal enrollments, guardians, attendance chronology,
  behavior scoring, audit history, password upgrade and Push subscriptions
  require separate verification.
- Backups and a verified RESTORE, full API parity, PHP/Node hosting
  safety review, real Push testing, consent/data-governance and approved
  cutover remain pending. Public API must stay 501/503 as currently
  configured.

## Developer tests

`npm test` runs `test/d1-rollback-rehearsal.test.cjs` offline without
opening sockets/databases. `check:batch12`, used by the existing
`check:all-staging` command, now includes those synthetic guard and
rollback regressions. No test imports actual school records.
