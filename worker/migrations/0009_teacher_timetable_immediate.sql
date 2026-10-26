-- Retire the approval gate without dropping audit/history columns or old timetable data.
-- Turn prior pending requests into active lessons only where no room/teacher period clashes.
-- Older pending entries win ties; conflicting entries remain editable but inactive.
UPDATE timetable AS t
SET active=1, approval_status='approved', reviewed_by=NULL, reviewed_at=NULL
WHERE t.approval_status='pending' AND t.active=0
 AND NOT EXISTS (
   SELECT 1 FROM timetable AS conflict
   WHERE conflict.id<>t.id AND conflict.day_of_week=t.day_of_week
     AND (conflict.classroom_id=t.classroom_id OR conflict.teacher_user_id=t.teacher_user_id)
     AND conflict.period<=COALESCE(t.end_period,t.period)
     AND COALESCE(conflict.end_period,conflict.period)>=t.period
     AND (conflict.active=1 OR (conflict.approval_status='pending' AND conflict.id<t.id))
 );
-- Any remaining pending rows had a time collision at conversion; keep them
-- disabled rather than granting unintended access to student rosters.
UPDATE timetable SET approval_status='rejected',active=0 WHERE approval_status='pending';
