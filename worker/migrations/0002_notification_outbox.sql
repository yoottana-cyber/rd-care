-- D1 event ledger for future advisor / guardian notifications.
-- No delivery mechanism, guardian contacts or subscriptions are included here.
-- Queue entries are only created after school attendance events, with guardian
-- events requiring the advisor's explicit confirmation.
CREATE TABLE IF NOT EXISTS notification_outbox (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 alert_id INTEGER NOT NULL REFERENCES attendance_alerts(id) ON DELETE CASCADE,
 event_type TEXT NOT NULL CHECK(event_type IN ('attendance_review_requested','absence_confirmed')),
 audience TEXT NOT NULL CHECK(audience IN ('advisor','guardian')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','cancelled','delivered','failed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(alert_id,event_type,audience),
 CHECK(
   (event_type='attendance_review_requested' AND audience='advisor')
   OR (event_type='absence_confirmed' AND audience='guardian')
 )
);
CREATE INDEX IF NOT EXISTS idx_notification_outbox_state
 ON notification_outbox(state,created_at);
