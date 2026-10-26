-- Permanent printed QR is a public entry link, NOT an authentication token.
-- The authenticated student submits a pending request only after 08:00 Bangkok.
-- Keep historical time-limited QR submissions intact for existing records.
CREATE TABLE IF NOT EXISTS late_static_qr_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id INTEGER NOT NULL UNIQUE REFERENCES late_self_requests(id) ON DELETE CASCADE,
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_late_static_qr_day
 ON late_static_qr_submissions(school_date,id);
