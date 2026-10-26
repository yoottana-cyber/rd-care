-- Bounded retries for urgent attendance notifications.
-- Initial send is immediate; cron retries transient failures without unlimited
-- repeat notifications. Prevent re-sending once a provider accepted a push.
ALTER TABLE truancy_push_deliveries ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0
 CHECK(attempts>=0 AND attempts<=3);
ALTER TABLE truancy_push_deliveries ADD COLUMN last_http_status INTEGER;
CREATE INDEX IF NOT EXISTS idx_truancy_push_retry
 ON truancy_push_deliveries(state,attempts,updated_at);
