"""Notification switches preserve score history and queue only new deductions."""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'worker'/'migrations'
class ScorePushMigrationTest(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for path in sorted(ROOT.glob('[0-9][0-9][0-9][0-9]_*.sql')):
   sql=path.read_text(encoding='utf8')
   self.db.executescript('BEGIN;\n'+sql+'\nCOMMIT;' if path.name.startswith('0040_') else sql)
  self.db.execute("INSERT OR IGNORE INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'a','Admin','admin','s','h')")
  self.db.execute("INSERT OR IGNORE INTO classrooms(id,grade,room,label) VALUES(11,1,1,'ม.1/1')")
  self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(101,'S101',11,1,'Test Student')")
  self.db.execute("INSERT INTO affairs_behavior_rules(name,category,points,active) VALUES('Minor','minor',-10,1)")
  self.rule=self.db.execute("SELECT id FROM affairs_behavior_rules WHERE name='Minor'").fetchone()[0]
  self.db.commit()
 def tearDown(self):self.db.close()
 def insert(self,points,warning):
  self.db.execute("""INSERT INTO behavior_incidents(
   student_id,affairs_rule_id,affairs_category,rule_points,points_applied,warning_no,reason,recorded_by)
   VALUES(101,?,'minor',-10,?,?,'Trial',1)""",(self.rule,points,warning))
  return self.db.execute('SELECT MAX(id) FROM behavior_incidents').fetchone()[0]
 def test_score_notification_created_only_for_new_deductions(self):
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM behavior_score_push_events').fetchone()[0],0)
  warning=self.insert(0,1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM behavior_score_push_events').fetchone()[0],0)
  charged=self.insert(-10,0)
  self.assertEqual(self.db.execute('SELECT incident_id FROM behavior_score_push_events').fetchone()[0],charged)
  self.assertEqual(self.db.execute('SELECT points FROM behavior_records ORDER BY id DESC LIMIT 1').fetchone()[0],-10)
  self.assertNotEqual(warning,charged)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_no_notification_for_legacy_scores_and_policy_changes_preserve_incidents(self):
  count=self.db.execute('SELECT COUNT(*) FROM notification_preferences').fetchone()[0]
  self.assertEqual(count,11)
  self.db.execute("UPDATE notification_preferences SET enabled=0 WHERE event_key='score_student'")
  self.assertEqual(self.db.execute("SELECT enabled FROM notification_preferences WHERE event_key='score_student'").fetchone()[0],0)
  self.insert(0,1)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM behavior_incidents').fetchone()[0],1)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
if __name__=='__main__':unittest.main()
