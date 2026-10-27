-- Auto-approved student QR arrivals with reversible school-day attendance and Push ledger.
-- Dedicated disabled machine actor avoids misattributing a student's QR submission
-- to a human staff member, but satisfies historical attendance FK requirements.
INSERT OR IGNORE INTO users(username,display_name,role,password_salt,password_hash,active)
VALUES('rd-care-late-system','RD Care • ระบบลงชื่อมาสาย','staff','system-disabled-no-login','system-disabled-no-login',0);

CREATE TABLE IF NOT EXISTS late_qr_auto_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 request_id INTEGER NOT NULL UNIQUE REFERENCES late_self_requests(id),
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 previous_daily_status TEXT CHECK(previous_daily_status IS NULL OR previous_daily_status IN('present','absent','late','leave')),
 previous_daily_recorded_by INTEGER REFERENCES users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 deleted_by INTEGER REFERENCES users(id),
 deleted_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_late_qr_auto_active ON late_qr_auto_events(active,school_date,id);

CREATE TABLE IF NOT EXISTS late_qr_push_deliveries (
 event_id INTEGER NOT NULL REFERENCES late_qr_auto_events(id),
 recipient_type TEXT NOT NULL CHECK(recipient_type IN('advisor','guardian')),
 subscription_id INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 last_http_status INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(event_id,recipient_type,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_late_qr_push_retry
 ON late_qr_push_deliveries(state,attempts,updated_at);
