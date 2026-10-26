-- Extend the existing timetable without discarding previously recorded attendance.
-- Legacy periods 11/12 remain readable; new lessons accept periods 1..10.
ALTER TABLE timetable ADD COLUMN subject_code TEXT NOT NULL DEFAULT '';
ALTER TABLE timetable ADD COLUMN end_period INTEGER CHECK(end_period IS NULL OR end_period BETWEEN 1 AND 12);
CREATE INDEX IF NOT EXISTS idx_timetable_room_week ON timetable(classroom_id,day_of_week,active,period);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher_week ON timetable(teacher_user_id,day_of_week,active,period);
