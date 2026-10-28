-- Durable, authenticated roster-only import jobs. Staging contains no passwords.
-- Individual row transactions preserve student IDs and historical attendance.
CREATE TABLE student_file_import_jobs (
 id TEXT PRIMARY KEY,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'uploading' CHECK(status IN('uploading','ready','running','completed')),
 total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 10000),
 uploaded INTEGER NOT NULL DEFAULT 0 CHECK(uploaded>=0),
 processed INTEGER NOT NULL DEFAULT 0 CHECK(processed>=0),
 added INTEGER NOT NULL DEFAULT 0 CHECK(added>=0),
 updated INTEGER NOT NULL DEFAULT 0 CHECK(updated>=0),
 skipped INTEGER NOT NULL DEFAULT 0 CHECK(skipped>=0),
 lock_until TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_student_file_import_jobs_owner ON student_file_import_jobs(actor_id,created_at DESC);
CREATE TABLE student_file_import_rows (
 job_id TEXT NOT NULL REFERENCES student_file_import_jobs(id) ON DELETE CASCADE,
 source_row INTEGER NOT NULL CHECK(source_row>=2),
 student_no TEXT NOT NULL,
 classroom TEXT NOT NULL,
 roll_no INTEGER,
 full_name TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','added','updated','skipped')),
 message TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(job_id,source_row)
);
CREATE INDEX idx_student_file_import_rows_pending ON student_file_import_rows(job_id,state,source_row);
