-- Accelerate 1,750+ student imports without replacing any student ID or
-- account. Queries use lower(student_no) and lower(username) for matching;
-- expression indexes avoid a full-table read for each student batch.
CREATE INDEX IF NOT EXISTS idx_students_import_no_casefold
 ON students(lower(student_no));
CREATE INDEX IF NOT EXISTS idx_portal_import_username_casefold
 ON portal_accounts(lower(username));
