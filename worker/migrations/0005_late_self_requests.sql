-- Student self-reports are separate from verified attendance records.
-- Tokens are staff-issued, one-time, short lived, and stored only as hashes.
-- A self-report NEVER changes attendance or creates a verified late_record.
CREATE TABLE late_self_passcodes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 code_hash TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 issued_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX idx_late_self_passcodes_expiry ON late_self_passcodes(expires_at);
CREATE TABLE late_self_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 arrived_at TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','verified','rejected')),
 verified_by INTEGER REFERENCES users(id),
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX idx_late_self_requests_state ON late_self_requests(state,school_date);
