# RD CONNECT — PHP/MySQL Migration Scaffold (NOT PRODUCTION READY)

This is an **isolated, fail-closed starting point** for porting RD CONNECT from
Cloudflare Workers + D1 to PHP 8.2+ / MySQL or MariaDB on cPanel/DirectAdmin.

**Nothing in this folder is currently a working login, attendance, score or
notification API.** Every route except migration health fails with 501, and
health returns HTTP 503 `migration_not_ready`. Do **not** point the real PWA
or students to this API until the port has been completed and reviewed.

## Folder layout

```text
php-hosting/
├── public/api/
│   ├── index.php        # only public PHP entry point
│   └── .htaccess        # Apache routing, no directory listings
├── private/
│   ├── bootstrap.php    # strict migration router, all other routes 501
│   ├── src/Database.php # PDO MySQL connector, not yet used
│   └── config.example.php
└── mysql/
    └── 0000_schema_migrations.sql  # metadata table, NOT complete schema
```

Future file layout on school hosting:

- `~/public_html/rd-connect/`: static PWA files from web/ and `api/`
- `~/rd-connect-private/`: `bootstrap.php`, `src/` and `config.local.php`
- `RD_CONNECT_PRIVATE_DIR`: full absolute filesystem path to `~/rd-connect-private`
- Never place PHP credentials or private files under `public_html`

This entry point expects the hosting environment to expose
`RD_CONNECT_PRIVATE_DIR`. Confirm that the hosting supports setting a
per-directory environment variable securely. Do NOT enable the PHP entrypoint
on a public domain until the hosting configuration is proven.

For local routing tests (no DB required):

```sh
RD_CONNECT_PRIVATE_DIR="$PWD/php-hosting/private" \
  php -S 127.0.0.1:8789 -t php-hosting/public/api php-hosting/public/api/index.php
# GET http://127.0.0.1:8789/api/health -> 503 migration_not_ready
# GET http://127.0.0.1:8789/api/login  -> 501 endpoint_not_migrated
```

For the complete phased migration plan see `docs/PHP-MYSQL-MIGRATION-PLAN.md`.
