-- Truancy is a separate, auditable classification of a period absence.
-- Keeping base attendance_period.status='absent' avoids rebuilding its CHECK table
-- and retains compatibility with existing attendance and historical reports.
CREATE TABLE IF NOT EXISTS period_truancy (
 student_id INTEGER NOT NULL,
 timetable_id INTEGER NOT NULL,
 school_date TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,timetable_id,school_date),
 FOREIGN KEY(student_id,timetable_id,school_date)
   REFERENCES attendance_period(student_id,timetable_id,school_date) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_period_truancy_date ON period_truancy(school_date,timetable_id);
CREATE TABLE IF NOT EXISTS truancy_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 generation INTEGER NOT NULL DEFAULT 1,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,timetable_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_truancy_events_active ON truancy_events(active,school_date);
CREATE TABLE IF NOT EXISTS guardian_push_subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 guardian_account_id INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_guardian_push_account ON guardian_push_subscriptions(guardian_account_id);
CREATE TABLE IF NOT EXISTS truancy_push_deliveries (
 event_id INTEGER NOT NULL REFERENCES truancy_events(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,
 recipient_type TEXT NOT NULL CHECK(recipient_type IN('advisor','guardian')),
 subscription_id INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','sending','delivered','failed')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(event_id,generation,recipient_type,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_truancy_push_state ON truancy_push_deliveries(state,updated_at);
