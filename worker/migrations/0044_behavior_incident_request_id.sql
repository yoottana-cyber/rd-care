-- Idempotent misconduct/merit entry: one occurrence per student per submitted request.
-- Avoid trusting D1 meta.changes/last_row_id when AFTER INSERT triggers write other tables.
-- Existing records are untouched; new requests are linked by a client-generated UUID.
ALTER TABLE behavior_incidents ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_behavior_incident_request_student
 ON behavior_incidents(request_id,student_id)
 WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_behavior_incident_request_id
 ON behavior_incidents(request_id) WHERE request_id IS NOT NULL;
