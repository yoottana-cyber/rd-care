"""Verify actual D1 late-QR Push event selection with real SQLite data."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
SCRIPT=(ROOT/'worker/src/late-qr-push.js').read_text(encoding='utf8')
START=SCRIPT.index('SELECT e.id,e.student_id,e.school_date,r.arrived_at,c.advisor_user_id')
END=SCRIPT.index('ORDER BY e.id DESC LIMIT 25',START)+len('ORDER BY e.id DESC LIMIT 25')
QUERY=SCRIPT[START:END]

def data():
 db=sqlite3.connect(':memory:')
 db.executescript("""
 CREATE TABLE late_qr_auto_events(id INTEGER PRIMARY KEY,request_id INTEGER,student_id INTEGER,school_date TEXT,active INTEGER,created_at TEXT);
 CREATE TABLE late_self_requests(id INTEGER PRIMARY KEY,state TEXT,arrived_at TEXT);
 CREATE TABLE student_enrollments(student_id INTEGER,classroom_id INTEGER,start_date TEXT,end_date TEXT);
 CREATE TABLE classrooms(id INTEGER PRIMARY KEY,advisor_user_id INTEGER);
 CREATE TABLE users(id INTEGER PRIMARY KEY,active INTEGER);
 CREATE TABLE staff_push_subscriptions(id INTEGER PRIMARY KEY,user_id INTEGER);
 CREATE TABLE guardian_push_subscriptions(id INTEGER PRIMARY KEY,guardian_account_id INTEGER);
 CREATE TABLE portal_accounts(id INTEGER PRIMARY KEY,role TEXT,active INTEGER,must_change_password INTEGER);
 CREATE TABLE guardian_student_links(guardian_account_id INTEGER,student_id INTEGER);
 CREATE TABLE late_qr_push_deliveries(event_id INTEGER,recipient_type TEXT,subscription_id INTEGER,state TEXT,attempts INTEGER);
 INSERT INTO classrooms VALUES(1,9);
 INSERT INTO student_enrollments VALUES(7,1,'1900-01-01',NULL);
 INSERT INTO users VALUES(9,1);
 INSERT INTO staff_push_subscriptions VALUES(3,9);
 INSERT INTO portal_accounts VALUES(11,'guardian',1,0);
 INSERT INTO guardian_student_links VALUES(11,7);
 INSERT INTO guardian_push_subscriptions VALUES(5,11);
 INSERT INTO late_self_requests VALUES(10,'verified','08:37');
 INSERT INTO late_qr_auto_events VALUES(
   15,10,7,date('now','+7 hours'),1,datetime('now')
 );
 """)
 return db

class LatePushSelectionTests(unittest.TestCase):
 def setUp(self):self.db=data()
 def tearDown(self):self.db.close()
 def events(self):return self.db.execute(QUERY).fetchall()
 def test_current_verified_event_with_consent_has_recipients(self):
  self.assertEqual([(r[0],r[1],r[4]) for r in self.events()],[(15,7,9)])
 def test_revoked_or_disputed_case_cannot_send(self):
  self.db.execute("UPDATE late_qr_auto_events SET active=0 WHERE id=15")
  self.assertEqual(self.events(),[])
  self.db.execute("UPDATE late_qr_auto_events SET active=1 WHERE id=15")
  self.db.execute("UPDATE late_self_requests SET state='rejected' WHERE id=10")
  self.assertEqual(self.events(),[])
 def test_no_recipients_no_push(self):
  self.db.execute("DELETE FROM staff_push_subscriptions")
  self.db.execute("DELETE FROM guardian_push_subscriptions")
  self.assertEqual(self.events(),[])
 def test_only_validated_guardian_or_advisor_receive(self):
  self.db.execute("DELETE FROM staff_push_subscriptions")
  self.assertEqual(len(self.events()),1)
  self.db.execute("UPDATE portal_accounts SET must_change_password=1 WHERE id=11")
  self.assertEqual(self.events(),[])
  self.db.execute("UPDATE portal_accounts SET must_change_password=0 WHERE id=11")
  self.db.execute("DELETE FROM guardian_student_links")
  self.assertEqual(self.events(),[])
 def test_accepted_push_is_not_selected_twice(self):
  self.db.execute("INSERT INTO late_qr_push_deliveries VALUES(15,'advisor',3,'delivered',1)")
  self.db.execute("INSERT INTO late_qr_push_deliveries VALUES(15,'guardian',5,'delivered',1)")
  self.assertEqual(self.events(),[])
 def test_maximum_three_retries_then_skip(self):
  self.db.execute("INSERT INTO late_qr_push_deliveries VALUES(15,'advisor',3,'failed',3)")
  self.db.execute("INSERT INTO late_qr_push_deliveries VALUES(15,'guardian',5,'failed',3)")
  self.assertEqual(self.events(),[])
 def test_backdated_case_not_sent_as_today(self):
  self.db.execute("UPDATE late_qr_auto_events SET school_date=date('now','+7 hours','-1 day')")
  self.assertEqual(self.events(),[])
if __name__=='__main__':unittest.main()
