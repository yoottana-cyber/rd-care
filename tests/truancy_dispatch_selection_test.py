"""Exercise the actual prioritized event-selection query against D1-compatible SQLite."""
import pathlib
import re
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SOURCE=(ROOT/"worker/src/truancy-push.js").read_text(encoding="utf8")

def real_dispatch_query():
    match=re.search(r"SELECT e\.id,e\.generation,e\.student_id,(?:e\.school_date,)?\s*c\.advisor_user_id(?:,t\.period,t\.subject)? FROM truancy_events e[\s\S]*?ORDER BY e\.id DESC LIMIT 25",SOURCE)
    if not match: raise AssertionError("Truancy dispatcher SQL not found")
    return match.group(0)

def database():
    db=sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for file in ("0001_initial.sql","0002_notification_outbox.sql",
                 "0006_student_guardian_portal.sql","0011_staff_web_push.sql",
                 "0013_truancy_push.sql","0014_truancy_priority_retries.sql"):
        db.executescript((ROOT/"worker/migrations"/file).read_text(encoding="utf8"))
    db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
                VALUES(1,'advisor','Advisor','teacher','salt','hash')""")
    db.execute("""INSERT INTO classrooms(id,grade,room,label,advisor_user_id)
                VALUES(1,1,1,'ม.1/1',1)""")
    db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
                VALUES(1,'ST01',1,1,'Student A')""")
    db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
                VALUES(1,1,1,1,1,'Math')""")
    db.execute("""INSERT INTO staff_push_subscriptions(user_id,endpoint,p256dh,auth)
                VALUES(1,'https://fcm.googleapis.com/fcm/send/test','key','auth')""")
    return db

def add_event(db,lesson_day):
    db.execute("""INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
                 VALUES(1,1,?,'absent',1)""",(lesson_day,))
    db.execute("""INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
                 VALUES(1,1,?,1)""",(lesson_day,))
    db.execute("""INSERT INTO truancy_events(student_id,timetable_id,school_date,recorded_by)
                 VALUES(1,1,?,1)""",(lesson_day,))
    return db.execute("SELECT id FROM truancy_events WHERE school_date=?",(lesson_day,)).fetchone()[0]

class DispatchSelectionTests(unittest.TestCase):
    def setUp(self):
        self.db=database()
        self.today=self.db.execute("SELECT date('now','+7 hours')").fetchone()[0]
        self.yesterday=self.db.execute("SELECT date('now','+7 hours','-1 day')").fetchone()[0]
        self.older=self.db.execute("SELECT date('now','+7 hours','-15 days')").fetchone()[0]
    def tearDown(self): self.db.close()

    def test_editing_yesterday_lesson_to_truancy_is_eligible_for_push(self):
        event_id=add_event(self.db,self.yesterday)
        events=self.db.execute(real_dispatch_query()).fetchall()
        self.assertEqual([event[0] for event in events],[event_id])

    def test_today_lesson_eligible_but_not_old_backfill(self):
        event_id=add_event(self.db,self.today)
        self.assertEqual([r[0] for r in self.db.execute(real_dispatch_query())],[event_id])
        self.db.execute("DELETE FROM period_truancy")
        self.db.execute("UPDATE truancy_events SET active=0")
        add_event(self.db,self.older)
        self.assertEqual(self.db.execute(real_dispatch_query()).fetchall(),[])

    def test_no_recipient_device_does_not_claim_delivery(self):
        add_event(self.db,self.today)
        self.db.execute("DELETE FROM staff_push_subscriptions")
        self.assertEqual(self.db.execute(real_dispatch_query()).fetchall(),[])

    def test_delivered_device_does_not_retrigger_on_same_status_resave(self):
        event_id=add_event(self.db,self.today)
        self.db.execute("""INSERT INTO truancy_push_deliveries
            (event_id,generation,recipient_type,subscription_id,state)
            VALUES(?,1,'advisor',1,'delivered')""",(event_id,))
        self.assertEqual(self.db.execute(real_dispatch_query()).fetchall(),[])
        # Changing to another status, then back to truancy must get a new generation.
        self.db.execute("UPDATE truancy_events SET generation=2 WHERE id=?",(event_id,))
        self.assertEqual([row[0] for row in self.db.execute(real_dispatch_query())],[event_id])

    def test_only_recent_edits_get_retried(self):
        add_event(self.db,self.today)
        self.db.execute("UPDATE truancy_events SET updated_at=datetime('now','-2 days')")
        self.assertEqual(self.db.execute(real_dispatch_query()).fetchall(),[])

if __name__=="__main__": unittest.main()
