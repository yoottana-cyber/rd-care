-- Admin-controlled outbound Push categories. Default ON preserves existing behavior.
-- Score notifications are queued ONLY for new genuine deductions after this migration.
CREATE TABLE IF NOT EXISTS notification_preferences (
 event_key TEXT PRIMARY KEY,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO notification_preferences(event_key,enabled) VALUES
 ('score_student',1),('score_guardian',1),
 ('truancy_student',1),('truancy_guardian',1),('truancy_advisor',1),
 ('late_student',1),('late_guardian',1),('late_advisor',1),
 ('review_advisor',1),('daily_reminder_advisor',1),
 ('student_message',1);

CREATE TABLE IF NOT EXISTS behavior_score_push_events (
 incident_id INTEGER PRIMARY KEY REFERENCES behavior_incidents(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS behavior_score_push_deliveries (
 incident_id INTEGER NOT NULL REFERENCES behavior_incidents(id),
 recipient_type TEXT NOT NULL CHECK(recipient_type IN ('student','guardian')),
 subscription_id INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 last_http_status INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(incident_id,recipient_type,subscription_id)
);
CREATE INDEX IF NOT EXISTS idx_behavior_score_push_state
 ON behavior_score_push_deliveries(state,attempts,updated_at);
CREATE TRIGGER IF NOT EXISTS behavior_score_notification_on_deduction
 AFTER INSERT ON behavior_incidents
 WHEN NEW.points_applied<0 AND NEW.deleted_at IS NULL
 BEGIN
  INSERT OR IGNORE INTO behavior_score_push_events(incident_id) VALUES(NEW.id);
 END;
