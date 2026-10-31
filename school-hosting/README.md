# RD CONNECT — Fastest standalone hosting on the SCHOOL server

**Implementation:** Same existing frontend/PWA and same Cloudflare Worker API code,
but running **locally on Node.js 24 + SQLite** instead of remotely on
Cloudflare Workers + D1. Node's built-in `node:sqlite` uses the same SQL
dialect and runs the original 46 SQLite migration files. **This is NOT MariaDB.**

This path avoids rewriting 28+ API endpoints, keeps existing teacher/student/
guardian/Student Affairs workflows and lives entirely on the school's
hosting **after** setup. The earlier experimental MariaDB PRs remain untouched.

**Status:** release candidate. GitHub tests and a separate school-host smoke
test must pass before personal data is imported or users are invited. Native
`node:sqlite` has a non-final stability designation in Node.js 24; school
hosting must support it, persistent private local disk, WAL locking and
reliable backups. Do not claim production readiness without checks below.

## Contents to upload

Download the entire branch `feature/school-direct-node-sqlite`.
Under a **new private Node application root** (outside `public_html`),
preserve this layout:

```text
app.js
package.json
school-hosting/
  d1-sqlite.cjs, migrate.cjs, server.cjs, setup-admin.cjs, backup.cjs, cron.cjs, test/
web/
  index.html, app.js, config.js, sw.js, css/, icons/, other assets
worker/
  package.json, src/, migrations/, classrooms_only.sql
```

No npm dependencies are needed for the Node-hosted version.
**Do not overwrite** `node-hosting/`, `ratsadaa_connect` or the Cloudflare
Worker/D1; this is a separate deployment path.

## Fast install — one DirectAdmin command

For a **new, empty, privately located** school database the recommended
path is [QUICK_START_TH.md](QUICK_START_TH.md):

1. Upload the full branch as one Node project and set four permanent
   environment variables and five temporary admin/init variables.
2. In Setup Node.js App → Run JS Script choose **`school:install`**.
3. It runs the synthetic test suite, installs 46 original migrations,
   seeds 48 rooms, creates the first admin locally and verifies an
   independent private SQLite backup. Expected exit **0**.
4. **Delete all five temporary secret/confirmation variables** and
   restart the app. Validate locally at the test URL before any school
   data import or domain switch.

This refuses an already-present database rather than overwriting it.
The individual `school:test`, `school:init`, `school:admin` and
`school:backup` scripts below remain available for fault isolation,
**not** for blindly repeating a partial installation.

## One-time DirectAdmin configuration

1. Create a **new** Node.js 24 app for example:
   - app root `/home/ratsadaa/rd-connect-school-app` (actual directory may vary)
   - app URL initial test `https://ratsada.ac.th/web/rd-connect-fast/`
   - application startup file `app.js`
   - Node environment `Development` for the first private test.
2. Create **two folders outside any publicly served directory**, e.g.
   `/home/ratsadaa/rd-connect-private` and
   `/home/ratsadaa/rd-connect-backups`. Restrict folder permissions to
   the account owner (`0700`).
3. In the Node app's Environment Variables set:
   - `RD_PUBLIC_ORIGIN=https://ratsada.ac.th`
   - `RD_APP_MOUNT=/web/rd-connect-fast`
   - `RD_SQLITE_FILE=/home/ratsadaa/rd-connect-private/rd-connect.sqlite`
   - `RD_SQLITE_BACKUP_DIR=/home/ratsadaa/rd-connect-backups`

   The DB filename must be an **absolute** path, not a symlink, and
   **outside** the uploaded `web/` directory and `public_html`.
   No MariaDB credentials or Cloudflare secrets are needed.
4. In DirectAdmin → Setup Node.js App → **Run JS Script** run
   `school:test`. This creates only **synthetic temporary** databases,
   imports all 46 original migrations, exercises the original Worker
   admin login and 48 rooms and checks the actual local HTTP mount.
   **Require exit 0.** If it fails, stop: do not initialize real data.

## Initialize own local school database

5. Temporarily set `RD_SCHOOL_INIT_CONFIRM` to
   `INITIALIZE_PRIVATE_SCHOOL_SQLITE`. Run `school:init`.
   It checks the original migration checksums, installs all migrations
   transactionally, runs integrity/FK checks and creates only the real
   48-room catalog (NO demo students, NO accounts). **Require exit 0.**
   Remove `RD_SCHOOL_INIT_CONFIRM` immediately afterward.
6. Create first admin account **offline**, not by public HTTP setup.
   Temporarily set the following Environment Variables:
   - `RD_SCHOOL_ADMIN_CONFIRM=CREATE_FIRST_SCHOOL_ADMIN`
   - `RD_SETUP_USERNAME` = your new secure admin username
   - `RD_SETUP_DISPLAY_NAME` = administrator display name
   - `RD_SETUP_PASSWORD` = a new strong unique password (12–128 characters)

   Run `school:admin`. Require exit 0. **Immediately DELETE all four
   temporary variables from DirectAdmin**; never put credentials in
   GitHub, file uploads, email or chat. This command refuses to create a
   second initial admin. Web `/api/setup` is explicitly disabled.
7. Run `school:backup`, verify exit 0 and keep the backup outside webroot.
   Set a backup schedule and regularly test restoration to a **separate
   temporary file** before using any real student data.
8. Restart the Node application using DirectAdmin. Open
   `https://ratsada.ac.th/web/rd-connect-fast/`.
   Health check: `https://ratsada.ac.th/web/rd-connect-fast/api/health`.
   Confirm staff login with the new local admin. Import the 48-room
   teacher, student and guardian records from the EXISTING upload templates
   through the Admin UI, **only after** school privacy/authorization review.
   Nothing will automatically copy the 1,751 D1 demo accounts; use the
   verified source files if historical data is not required.

## After private validation

The entire PWA and the original Worker API are served from the school's
own HTTPS app at the same mount. `web/config.js` now resolves the API base
relative to the app path; no CORS, Cloudflare Service Binding, PHP proxy or
28-endpoint rewrite is required.

Once approved, change the Node app URL from `/web/rd-connect-fast/` to
`/web/rd-connect/`, and update `RD_APP_MOUNT=/web/rd-connect` at
the same time. Do not conflict with any earlier app using that URL.

Web Push and reminders use the original Worker scheduled function:
configure school-specific VAPID keys and subscriptions, then schedule
`school:cron` every five minutes through DirectAdmin Cron, using the
hosting-provided Node runtime. **Do not enable real Push until the end-to-end
device and opt-in checks pass**, and do not rely on Passenger uptime as a
replacement for Cron.

## Operational constraints

- SQLite is a real disk database, but **not MariaDB**; do not point a
  MariaDB admin console at it. It is best for one school system on one
  shared-hosting server with local-disk WAL support. Multi-server replication,
  network-mounted databases and very high concurrent writers need a
  different architecture.
- SQLite WAL requires `rd-connect.sqlite`, `-wal` and `-shm` files
  to remain together. Back up using `school:backup`, **not** by copying
  only the live SQLite file while the app is running.
- During a restore, stop the Node app and any Cron job, verify a backup
  on an isolated copy first, retain the old database as rollback, restore
  under the same private permissions, then re-run integrity checks.
- Use HTTPS, least-privilege staff and guardian/student links, stronger
  passwords, secure administration and school PDPA procedures. The
  server-side `/api/setup` route is disabled; the initial admin is
  provisioned by the offline command.
- If test failures, 502/500, unexpected DB locks or data-integrity
  warnings occur, **stop** the school rollout; do not switch the live
  domain or restore over the only DB copy.
- Cloudflare D1 and its existing records remain unchanged throughout this
  new installation.

## Future option

MariaDB can be revisited when actual usage proves that SQLite cannot meet
the load and multi-server requirements. The **fastest route to a working
school-hosted RD CONNECT** is to reuse its original SQLite schema and
Worker business logic with this local adapter, not reimplement every API.
