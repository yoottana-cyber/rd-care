-- Remove stale advisor-review work where the DAILY register already recorded
-- absence on the same date. Preserve the period-attendance and audit history.
-- Leave delivered events and reviewed/confirmed alerts untouched.
UPDATE notification_outbox
SET state='cancelled',updated_at=CURRENT_TIMESTAMP
WHERE state='pending' AND audience='advisor' AND EXISTS (
 SELECT 1 FROM attendance_alerts a JOIN attendance_daily d
  ON d.student_id=a.student_id AND d.school_date=a.school_date
 WHERE a.id=notification_outbox.alert_id AND a.state='pending_review'
   AND d.status='absent'
);
UPDATE attendance_alerts
SET state='resolved',reviewed_by=NULL,reviewed_at=NULL
WHERE state='pending_review' AND EXISTS (
 SELECT 1 FROM attendance_daily d
 WHERE d.student_id=attendance_alerts.student_id
   AND d.school_date=attendance_alerts.school_date AND d.status='absent'
);
