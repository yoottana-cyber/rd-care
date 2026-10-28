-- One-time operator recovery marker. Atomic INSERT aborts all password changes if reused.
CREATE TABLE IF NOT EXISTS admin_recovery_state(
 id INTEGER PRIMARY KEY CHECK(id=1),
 used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
