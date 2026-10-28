-- Central school-wide configuration. Do not delete or rewrite historical attendance.
CREATE TABLE IF NOT EXISTS school_settings (
 id INTEGER PRIMARY KEY CHECK (id=1),
 school_name TEXT NOT NULL DEFAULT 'โรงเรียนรัษฎา',
 academic_year INTEGER NOT NULL DEFAULT 2569 CHECK (academic_year BETWEEN 2500 AND 2700),
 semester INTEGER NOT NULL DEFAULT 2 CHECK (semester IN (1,2)),
 semester_start_date TEXT,
 semester_end_date TEXT,
 school_start_time TEXT NOT NULL DEFAULT '08:00',
 late_cutoff_time TEXT NOT NULL DEFAULT '08:00',
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO school_settings(id) VALUES(1);

CREATE TABLE IF NOT EXISTS school_settings_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 previous_value TEXT NOT NULL,
 next_value TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_school_settings_history_recent
 ON school_settings_history(created_at DESC,id DESC);
