# RD CONNECT — Stage 12: synthetic JSONL → MariaDB rollback rehearsal

**STATUS: EXPERIMENTAL / NO_GO. No real school records.**
The school Cloudflare D1/Worker/PWA is unchanged and remains the source
of truth. This experiment never enables public login/API or actual Push.

## Before starting

- Use **ONLY** the isolated Node app at
  `/home/ratsadaa/rd-connect-node-stage/` and empty MariaDB
  `ratsadaa_connect`. Do NOT run on a live school DB.
- Existing `RD_DB_*` secrets must be configured privately in DirectAdmin
  and scoped to staging only. Do not share them with GitHub/ChatGPT.
- Keep `RD_TRIGGER_LAB_ALLOW_*`, `RD_MIGRATION_ALLOW_IMPORT` and
  `RD_ENABLE_SCHOOL_WRITES` unset.
- Upload the **full node-hosting/** contents from the experimental branch.
  The standard `check:all-staging` must continue to pass all 11 groups.

## A. Generate an entirely fictional, private fixture (no D1 export)

DirectAdmin → Setup Node.js App → Run JS Script:

```
make:d1-fixture
```

Expected exit code 0:

```text
STAGE 12 SYNTHETIC FIXTURE READY: 63 tables, 1 fictional disabled account, NO SCHOOL ROWS READ.
PRIVATE MANIFEST PATH: /home/ratsadaa/.rd-connect-stage12-synthetic-.../manifest.json
NEXT: configure RD_D1_MANIFEST_FILE with this exact path and explicitly authorize rehearsal.
PUBLIC API STILL CLOSED / RELEASE NO_GO.
```

**Copy the precise path shown by your server**, not the placeholder above.
The generator reads only `information_schema` and verifies all 63 MariaDB
tables are empty, InnoDB, with 119 foreign keys and 0 triggers.
It creates 63 private JSONL files with only **one invented, inactive
teacher account** (not a valid password hash). The other 62 tables
contain zero rows. The source manifest is visibly labeled
`synthetic-staging-schema` and cannot be confused with a real D1 export.

The fixture directory is automatically chosen under the private home
directory, *outside public_html and outside Git*. Permissions are restricted
to the owning account where supported. Do not upload these files to
GitHub or a public web path.

## B. Explicitly authorize a rollback-only replay

In DirectAdmin → the **TEST Node app** → Environment Variables
temporarily add:

```text
RD_D1_MANIFEST_FILE=<the exact private manifest path from A>
RD_D1_REHEARSAL_CONFIRM=RUN_SYNTHETIC_D1_ROLLBACK_ONLY
```

Do **not** set `RD_MIGRATION_ALLOW_IMPORT` or any live-write flag.
Run JS Script:

```
check:d1-rehearsal
```

Expected success:

```text
returncode: 0
STAGE 12 SYNTHETIC REHEARSAL PASS: 63 tables, 1 private fixture rows compared inside transaction.
ROLLBACK VERIFIED: 63 staging tables empty, 119 FKs, zero triggers.
PUBLIC API CLOSED / NO REAL PUSH / RELEASE NO_GO.
```

The script validates every JSONL hash/count BEFORE connecting to MariaDB,
checks the empty staging schema, replays only the explicitly labeled
synthetic fixture using prepared statements in FK dependency order,
checks row counts and FK relationships **inside one uncommitted transaction**,
then **ROLLBACKs and rechecks all 63 tables are empty**. There is no COMMIT.

**Remove both temporary environment variables immediately afterward.**
Run `check:all-staging` once more to confirm the usual 11-group tests
are still intact. An unexpected exit 1, FK-cycle blocker, missing rollback
confirmation or post-rollback mismatch means **STOP** and inspect the
isolated staging DB privately. Do not repeatedly attempt a failed test,
bypass FK checks or enable HTTP endpoints.

## Distinguish this from real D1 migration

- `make:d1-fixture` **does not connect to D1, does not export real
  student data**, and does not demonstrate real-data type compatibility.
- `check:d1-rehearsal` **rejects real D1 source manifests**; it accepts
  only the private `synthetic-staging-schema` source marker.
- The pre-existing `export-d1-sql-to-jsonl.py` and
  `check:d1-migration-plan` remain separate, private *planning* tools,
  not an approved real-data importer.
- Even after PASS, complete history, identity/password upgrades,
  attendance/truancy semantics, behavior/merit, guardian relationships,
  non-lossy type mapping, actual backup + restore, full API and Push parity
  are unverified. The release gate **MUST remain NO_GO**.

**Transaction note:** an InnoDB ROLLBACK may advance AUTO_INCREMENT
counters. For that reason the database must be disposable, isolated,
and empty before and after this run.
