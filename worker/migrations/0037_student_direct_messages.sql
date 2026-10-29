-- Private 1:1 messages from authorized Student Affairs personnel to students.
-- Message text is stored only in D1 and is never included in Web Push payloads.
CREATE TABLE student_direct_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 sender_id INTEGER NOT NULL REFERENCES users(id),
 subject TEXT NOT NULL CHECK(length(subject) BETWEEN 2 AND 80),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 5 AND 500),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 read_at TEXT
);
CREATE INDEX idx_student_direct_messages_student ON student_direct_messages(student_id,id DESC);
CREATE INDEX idx_student_direct_messages_sender ON student_direct_messages(sender_id,id DESC);

CREATE TABLE student_message_push_deliveries (
 message_id INTEGER NOT NULL REFERENCES student_direct_messages(id) ON DELETE CASCADE,
 subscription_id INTEGER NOT NULL REFERENCES student_push_subscriptions(id) ON DELETE CASCADE,
 state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','sending','delivered','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),
 last_http_status INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(message_id,subscription_id)
);
CREATE INDEX idx_student_message_push_pending
 ON student_message_push_deliveries(state,attempts,updated_at);
