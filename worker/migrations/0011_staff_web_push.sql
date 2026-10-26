-- Staff Push subscriptions are opt-in and bound to the currently authenticated user.
-- No student identifiers, personal names, or device IPs are stored.
CREATE TABLE IF NOT EXISTS staff_push_subscriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staff_push_user ON staff_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS staff_push_deliveries (
 outbox_id INTEGER NOT NULL REFERENCES notification_outbox(id) ON DELETE CASCADE,
 subscription_id INTEGER NOT NULL REFERENCES staff_push_subscriptions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','delivered','failed')),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(outbox_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_push_deliveries_state ON staff_push_deliveries(state,updated_at);
