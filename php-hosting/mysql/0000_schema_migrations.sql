-- RD CONNECT MySQL port: migration bookkeeping ONLY (not the school schema).
-- Apply on a NEW, EMPTY MySQL/MariaDB database; never import demo data here.
-- Subsequent school tables must be translated and verified individually.
CREATE TABLE IF NOT EXISTS rd_schema_migrations (
  version VARCHAR(80) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
