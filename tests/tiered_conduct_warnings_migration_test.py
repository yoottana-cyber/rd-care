"""Regress tiered misconduct, independent rule counts and automatic truancy correction."""
import sqlite3,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'worker'/'migrations'
class TieredConductRules(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:')
  self.db.execute('PRAGMA foreign_keys=ON')
  for f in sorted(ROOT.glob('[0-9][0-9][0-9][0-9]_*.sql')):
   sql=f.read_text(encoding='utf8')
   self.db.executescript('BEGIN;\n'+sql+'\nCOMMIT;' if f.name.startswith('0040_') else sql)
  self.db.execute("""INSERT OR IGNORE INTO users(id,username,display_name,role,password_salt,password_hash)
   VALUES(1,'teacher','Teacher','teacher','s','h')""")
  self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(111,1,1,'ม.1/1')")
  for st in (1,2):
   self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(?,?,111,?,?)",
    (st,'ST'+str(st),st,'Student '+str(st)))
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(1,111,1,4,2,'Math')""")
  self.db.execute("""INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject)
   VALUES(2,111,1,4,3,'English')""")
  for t in (1,2):
   self.db.execute("""INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by)
    VALUES(1,?,'2026-10-29','absent',1)""",(t,))
  self.db.commit()
  self.db.execute("""INSERT INTO affairs_behavior_rules(name,category,points,active)
   VALUES('ทดสอบเล็กน้อย','minor',-5,1),('ทดสอบปานกลาง','moderate',-10,1),
         ('ทดสอบร้ายแรง','serious',-80,1),('ทดสอบร้ายแรงมาก','very_serious',-120,1)""")
  self.rules={r[1]:r[0] for r in self.db.execute(
   "SELECT id,name FROM affairs_behavior_rules WHERE name LIKE 'ทดสอบ%'")}

 def tearDown(self):self.db.close()
 def record(self,student,ruleName):
  rule=self.rules[ruleName]
  self.db.execute("""INSERT INTO behavior_incidents(student_id,affairs_rule_id,affairs_category,
   rule_points,reason,recorded_by,points_applied,warning_no)
   SELECT ?,r.id,r.category,r.points,r.name,1,
   CASE WHEN (r.category='minor' AND h.n<2) OR (r.category='moderate' AND h.n<1)
    THEN 0 ELSE r.points END,
   CASE WHEN (r.category='minor' AND h.n<2) OR (r.category='moderate' AND h.n<1)
    THEN h.n+1 ELSE 0 END
   FROM affairs_behavior_rules r CROSS JOIN
    (SELECT COUNT(*) n FROM behavior_incidents WHERE student_id=? AND affairs_rule_id=?
     AND deleted_at IS NULL) h
   WHERE r.id=?""",(student,student,rule,rule))
  return self.db.execute("""SELECT points_applied,warning_no,behavior_record_id
   FROM behavior_incidents ORDER BY id DESC LIMIT 1""").fetchone()
 def total(self,student=1):
  return self.db.execute("""SELECT COALESCE(SUM(points),0) FROM behavior_records
   WHERE student_id=? AND deleted_at IS NULL""",(student,)).fetchone()[0]
 def test_minor_warning_first_two_and_deduct_third_plus_later(self):
  rule=self.rules['ทดสอบเล็กน้อย']
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(0,1))
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(0,2))
  self.assertEqual(self.total(),0)
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(-5,0))
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(-5,0))
  self.assertEqual(self.total(),-10)
  self.assertEqual(self.record(2,'ทดสอบเล็กน้อย')[:2],(0,1))
  self.assertEqual(self.total(2),0)
  self.assertEqual(self.db.execute('SELECT COUNT(*) FROM behavior_incidents WHERE affairs_rule_id=?',(rule,)).fetchone()[0],5)
 def test_moderate_warn_once_then_deduct_each_time_and_rules_are_independent(self):
  self.assertEqual(self.record(1,'ทดสอบปานกลาง')[:2],(0,1))
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(0,1))
  self.assertEqual(self.record(1,'ทดสอบปานกลาง')[:2],(-10,0))
  self.assertEqual(self.record(1,'ทดสอบปานกลาง')[:2],(-10,0))
  self.assertEqual(self.total(),-20)
 def test_serious_and_very_serious_deduct_first_time(self):
  self.assertEqual(self.record(1,'ทดสอบร้ายแรง')[0],-80)
  self.assertEqual(self.record(1,'ทดสอบร้ายแรงมาก')[0],-120)
  self.assertEqual(self.total(),-200)
 def test_deleted_warning_is_not_counted_toward_threshold(self):
  first=self.record(1,'ทดสอบเล็กน้อย')
  self.assertEqual(first[0],0)
  id=self.db.execute('SELECT MAX(id) FROM behavior_incidents').fetchone()[0]
  self.db.execute('UPDATE behavior_incidents SET deleted_at=CURRENT_TIMESTAMP WHERE id=?',(id,))
  self.assertEqual(self.record(1,'ทดสอบเล็กน้อย')[:2],(0,1))
 def test_deleted_score_does_not_count_against_threshold(self):
  self.record(1,'ทดสอบปานกลาง')
  second=self.record(1,'ทดสอบปานกลาง')
  self.assertEqual(second[0],-10)
  self.db.execute('UPDATE behavior_records SET deleted_at=CURRENT_TIMESTAMP WHERE id=?',(second[2],))
  self.assertEqual(self.record(1,'ทดสอบปานกลาง')[0],-10)
 def test_truancy_warning_then_deduction_and_correction_reverses(self):
  rule=self.db.execute('SELECT rule_id FROM truancy_score_policy WHERE id=1').fetchone()[0]
  category=self.db.execute('SELECT category FROM affairs_behavior_rules WHERE id=?',(rule,)).fetchone()[0]
  self.assertEqual(category,'moderate')
  def classify(t):
   self.db.execute("""INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by)
    VALUES(1,?,'2026-10-29',1)
    ON CONFLICT(student_id,timetable_id,school_date) DO UPDATE SET recorded_by=excluded.recorded_by""",(t,))
  classify(1)
  self.assertEqual(self.total(),0)
  self.assertEqual(self.db.execute("""SELECT points_applied,warning_no
   FROM behavior_incidents WHERE source_timetable_id=1""").fetchone(),(0,1))
  classify(1)
  self.assertEqual(self.db.execute("""SELECT count(*) FROM behavior_incidents WHERE source_timetable_id=1""").fetchone()[0],1)
  classify(2)
  self.assertEqual(self.total(),-10)
  scored=self.db.execute('SELECT behavior_record_id FROM behavior_incidents WHERE source_timetable_id=2').fetchone()[0]
  self.assertIsNotNone(scored)
  self.db.execute("DELETE FROM period_truancy WHERE student_id=1 AND timetable_id=2")
  self.assertEqual(self.total(),0)
  classify(2)
  self.assertEqual(self.total(),-10)
  self.assertEqual(self.db.execute('SELECT behavior_record_id FROM behavior_incidents WHERE source_timetable_id=2').fetchone()[0],scored)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
 def test_idempotent_retry_does_not_create_second_warning_or_deduction(self):
  token='fedf9b9e-f119-46d8-a8e1-606197aabc12'
  rule=self.rules['ทดสอบปานกลาง']
  def submit(request_id,student=1):
   self.db.execute("""INSERT OR IGNORE INTO behavior_incidents(
    student_id,affairs_rule_id,affairs_category,rule_points,reason,recorded_by,
    points_applied,warning_no,request_id)
    SELECT ?,r.id,r.category,r.points,'ทดสอบความผิด',1,
     CASE WHEN (r.category='minor' AND h.n<2) OR (r.category='moderate' AND h.n<1)
      THEN 0 ELSE r.points END,
     CASE WHEN (r.category='minor' AND h.n<2) OR (r.category='moderate' AND h.n<1)
      THEN h.n+1 ELSE 0 END,?
    FROM affairs_behavior_rules r
    CROSS JOIN (SELECT COUNT(*) n FROM behavior_incidents i
     WHERE i.student_id=? AND i.affairs_rule_id=? AND i.deleted_at IS NULL) h
    WHERE r.id=? AND r.active=1 AND r.deleted_at IS NULL
      AND r.id NOT IN (SELECT rule_id FROM truancy_score_policy)""",
    (student,request_id,student,rule,rule))
   return self.db.execute("""SELECT id,student_id,points_applied,warning_no
    FROM behavior_incidents WHERE request_id=? AND student_id=?""",
    (request_id,student)).fetchone()
  original=submit(token)
  self.assertEqual(original[2:],(0,1))
  for _ in range(3):
   self.assertEqual(submit(token),original)
  self.assertEqual(self.db.execute(
   'SELECT COUNT(*) FROM behavior_incidents WHERE student_id=1 AND affairs_rule_id=?',(rule,)
  ).fetchone()[0],1)
  self.assertEqual(self.total(),0)
  next_token='8ff27d6a-bbee-4b1a-99bd-e2aa11b524c3'
  scored=submit(next_token)
  self.assertEqual(scored[2:],(-10,0))
  self.assertEqual(self.total(),-10)
  self.assertEqual(submit(next_token),scored)
  self.assertEqual(self.total(),-10)
  self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

if __name__=='__main__':unittest.main()
