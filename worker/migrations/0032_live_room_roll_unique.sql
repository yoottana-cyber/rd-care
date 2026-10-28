-- Identity-keyed roster v2 for NEW D1 databases.
-- Archived student rows stay linked to historical attendance and are not seat owners.
-- Paused (active=0) students without deleted_at still reserve a seat.
-- NOTE: an existing database initialized with legacy 0001 still retains its
-- embedded UNIQUE(classroom_id,roll_no); use a fresh D1 database for this change.
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_current_room_roll
 ON students(classroom_id,roll_no) WHERE deleted_at IS NULL;
