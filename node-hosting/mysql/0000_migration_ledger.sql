-- This is a migration bookkeeping table ONLY, not the RD CONNECT school schema.
-- Do not run D1 SQLite migrations directly against MariaDB.
-- Run only on a NEW, empty school staging database after backup verification.
CREATE TABLE IF NOT EXISTS rd_schema_migrations (
  version VARCHAR(80) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
