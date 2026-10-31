-- RD CONNECT | STAGE 7.2 | DRAFT ONLY | DO NOT EXECUTE ON SCHOOL DATABASE
-- This file describes the first 3 D1 trigger equivalents for MariaDB 10.4.
-- ORIGINAL: guardian_link_role_guard, timetable_clash_insert, timetable_clash_update.
-- NOT TESTED ON MariaDB. DO NOT IMPORT INTO phpMyAdmin AT THIS STAGE.
-- Applying CREATE TRIGGER commits independently of ROLLBACK!
--
-- IMPORTANT INCOMPLETE GUARANTEES:
-- (1) The timetable EXISTS queries mirror old D1 single-writer behavior, but
--     DO NOT prove conflict exclusion under concurrent transactions.
--     Before production: serialize writes by teacher+classroom, use current
--     locking reads, and run two-connection race tests against disposable DB.
-- (2) The D1 guardian guard only checks INSERT. It does not prevent a
--     linked portal account being reassigned from guardian to student later.
--     A separate hardening change must close that loophole.
-- (3) Keep school public Login HTTP 501; no production migration is approved.
--
-- Separate document and parser-only checker review this draft.
-- Multi-statement trigger bodies require client DELIMITER support.
-- These are NOT safe to apply to a database with real school records.

DELIMITER $$

CREATE TRIGGER guardian_link_role_guard
BEFORE INSERT ON guardian_student_links
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM portal_accounts pa
    WHERE pa.id = NEW.guardian_account_id
      AND pa.role = 'guardian'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'guardian_account_required';
  END IF;
END$$

CREATE TRIGGER timetable_clash_insert
BEFORE INSERT ON timetable
FOR EACH ROW
BEGIN
  IF NEW.active = 1 AND EXISTS (
    SELECT 1
    FROM timetable t
    WHERE t.active = 1
      AND t.day_of_week = NEW.day_of_week
      AND (
        t.classroom_id = NEW.classroom_id
        OR t.teacher_user_id = NEW.teacher_user_id
      )
      AND t.period <= COALESCE(NEW.end_period, NEW.period)
      AND COALESCE(t.end_period, t.period) >= NEW.period
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'TIMETABLE_OVERLAP';
  END IF;
END$$

CREATE TRIGGER timetable_clash_update
BEFORE UPDATE ON timetable
FOR EACH ROW
BEGIN
  IF NEW.active = 1 AND EXISTS (
    SELECT 1
    FROM timetable t
    WHERE t.id <> OLD.id
      AND t.active = 1
      AND t.day_of_week = NEW.day_of_week
      AND (
        t.classroom_id = NEW.classroom_id
        OR t.teacher_user_id = NEW.teacher_user_id
      )
      AND t.period <= COALESCE(NEW.end_period, NEW.period)
      AND COALESCE(t.end_period, t.period) >= NEW.period
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'TIMETABLE_OVERLAP';
  END IF;
END$$

DELIMITER ;
