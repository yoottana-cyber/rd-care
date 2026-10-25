-- Separate portal identity boundary: never reuse staff `users` or `sessions`.
-- School staff must verify a guardian identity/relationship before linking access.
CREATE TABLE portal_accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('student','guardian')),
 student_id INTEGER UNIQUE REFERENCES students(id),
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((role='student' AND student_id IS NOT NULL) OR (role='guardian' AND student_id IS NULL))
);
CREATE INDEX idx_portal_account_role ON portal_accounts(role,active);
CREATE TABLE portal_sessions (
 token_hash TEXT PRIMARY KEY,
 account_id INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_portal_sessions_account ON portal_sessions(account_id);
CREATE TABLE portal_login_attempts (
 username TEXT PRIMARY KEY,
 failures INTEGER NOT NULL DEFAULT 0,
 locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE guardian_student_links (
 guardian_account_id INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
 student_id INTEGER NOT NULL REFERENCES students(id),
 verified_by INTEGER NOT NULL REFERENCES users(id),
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (guardian_account_id,student_id)
);
CREATE INDEX idx_guardian_student_links_student ON guardian_student_links(student_id);
