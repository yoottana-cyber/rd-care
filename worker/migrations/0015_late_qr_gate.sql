-- School gate QR late-arrival registration. Tokens are never stored in plaintext.
-- Students must use their own authenticated portal accounts and staff verify scans.
CREATE TABLE IF NOT EXISTS late_qr_tokens (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 issued_by INTEGER NOT NULL REFERENCES users(id),
 school_date TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_late_qr_tokens_staff ON late_qr_tokens(issued_by,school_date,expires_at);
CREATE TABLE IF NOT EXISTS late_qr_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id INTEGER NOT NULL UNIQUE REFERENCES late_self_requests(id) ON DELETE CASCADE,
 token_id INTEGER NOT NULL REFERENCES late_qr_tokens(id),
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 issued_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_late_qr_submissions_issued ON late_qr_submissions(issued_by,school_date,id);
