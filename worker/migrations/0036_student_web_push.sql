-- Independent Push subscriptions for the authenticated student portal account.
-- No changes to existing staff or guardian Push subscriptions.
CREATE TABLE IF NOT EXISTS student_push_subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_account_id INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_student_push_account ON student_push_subscriptions(student_account_id);
CREATE TABLE IF NOT EXISTS student_push_deliveries (
 event_kind TEXT NOT NULL CHECK(event_kind IN ('truancy','late')),
 event_id INTEGER NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 subscription_id INTEGER NOT NULL REFERENCES student_push_subscriptions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 last_http_status INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(event_kind,event_id,generation,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_student_push_delivery_state ON student_push_deliveries(state,attempts,updated_at);
