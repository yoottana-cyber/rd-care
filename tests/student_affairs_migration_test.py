import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class StudentAffairsSchema(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for filename in ['worker/migrations/0001_initial.sql',
                         'worker/migrations/0018_student_affairs.sql',
                         'worker/migrations/0019_student_affairs_role_assignments.sql',
                         'worker/migrations/0020_separate_merit_conduct_adjustments.sql']:
            self.db.executescript((ROOT/filename).read_text(encoding='utf-8'))
        self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
            VALUES(1,'teacher1','ครูที่ปรึกษา','teacher','x','x'),
            (2,'staff1','กิจการนักเรียน','staff','x','x')""")
        self.db.execute("""INSERT INTO classrooms(id,grade,room,label,advisor_user_id)
            VALUES(1,3,1,'ม.3/1',1)""")
        self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
            VALUES(1,'1234',1,1,'นักเรียนทดสอบ')""")

    def test_teacher_assignment_preserves_teacher_role_and_is_revocable(self):
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM student_affairs_assignments").fetchone()[0],0)
        self.db.execute("""INSERT INTO student_affairs_assignments(user_id,assigned_by)
            VALUES(1,2)""")
        self.assertEqual(self.db.execute(
            "SELECT role FROM users WHERE id=1").fetchone(),('teacher',))
        self.assertEqual(self.db.execute(
            "SELECT assigned_by FROM student_affairs_assignments WHERE user_id=1").fetchone(),(2,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO student_affairs_assignments(user_id,assigned_by) VALUES(1,2)")
        self.db.execute("DELETE FROM student_affairs_assignments WHERE user_id=1")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM student_affairs_assignments WHERE user_id=1").fetchone(),(0,))

    def test_assigned_permission_is_removed_when_teacher_account_deleted(self):
        self.db.execute("INSERT INTO student_affairs_assignments(user_id,assigned_by) VALUES(1,2)")
        self.db.execute("UPDATE classrooms SET advisor_user_id=NULL WHERE advisor_user_id=1")
        self.db.execute("DELETE FROM users WHERE id=1")
        self.assertEqual(self.db.execute(
            "SELECT COUNT(*) FROM student_affairs_assignments WHERE user_id=1").fetchone(),(0,))

    def test_merit_does_not_cancel_misconduct(self):
        self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_category)
            VALUES(1,20,'ช่วยงานโรงเรียน',1,'good')""")
        self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_category)
            VALUES(1,-10,'ความผิด',1,'moderate')""")
        self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points,updated_by)
            VALUES('ปรับพฤติกรรม 5 คะแนน',5,2)""")
        self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points,updated_by)
            VALUES('ปรับพฤติกรรม 10 คะแนน',10,2)""")
        rows=self.db.execute("""SELECT
           COALESCE(SUM(CASE WHEN points>0 AND (affairs_category IS NULL
              OR affairs_category='good') THEN points ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN points<0 THEN -points ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN points>0 AND affairs_category='adjustment'
              THEN points ELSE 0 END),0)
            FROM behavior_records WHERE student_id=1""").fetchone()
        self.assertEqual(rows,(20,10,0))
        self.assertEqual(rows[1]-rows[2],10)

    def test_improvement_is_only_from_approved_rule_and_cannot_overdraw(self):
        self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by,
            affairs_category) VALUES(1,-10,'ความผิด',1,'moderate')""")
        self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points,updated_by)
            VALUES('ปรับพฤติกรรม 5 คะแนน',5,2)""")
        self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points,updated_by)
            VALUES('ปรับพฤติกรรม 10 คะแนน',10,2)""")
        row=self.db.execute("SELECT id,points FROM affairs_adjustment_rules WHERE points=5").fetchone()
        result=self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by,
             affairs_category,adjustment_rule_id)
             SELECT 1,?,'ปรับพฤติกรรม',2,'adjustment',? WHERE ?>0 AND ?<=
              (SELECT COALESCE(SUM(CASE WHEN points<0 THEN -points
                  WHEN affairs_category='adjustment' AND points>0 THEN -points
                  ELSE 0 END),0)
               FROM behavior_records WHERE student_id=1)""",
             (row[1],row[0],row[1],row[1]))
        self.assertEqual(result.rowcount,1)
        remaining=self.db.execute("""SELECT COALESCE(SUM(CASE WHEN points<0 THEN -points
            WHEN affairs_category='adjustment' AND points>0 THEN -points ELSE 0 END),0)
            FROM behavior_records WHERE student_id=1""").fetchone()[0]
        self.assertEqual(remaining,5)
        over=self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by,
            affairs_category,adjustment_rule_id)
            SELECT 1,10,'ปรับพฤติกรรม',2,'adjustment',2 WHERE 10<=
              (SELECT COALESCE(SUM(CASE WHEN points<0 THEN -points
               WHEN affairs_category='adjustment' AND points>0 THEN -points ELSE 0 END),0)
               FROM behavior_records WHERE student_id=1)""")
        self.assertEqual(over.rowcount,0)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points)
                VALUES('ค่าติดลบ',-5)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO affairs_adjustment_rules(name,points)
                VALUES('เกินขนาด',51)""")

    def test_legacy_positive_without_category_is_merit_not_improvement(self):
        self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by)
         VALUES(1,30,'รายการความดีเดิม',1)""")
        self.db.execute("""INSERT INTO behavior_records(student_id,points,reason,recorded_by)
         VALUES(1,-8,'รายการความผิดเดิม',1)""")
        self.assertEqual(self.db.execute("""SELECT COALESCE(SUM(CASE WHEN
           points>0 AND (affairs_category IS NULL OR affairs_category='good')
           THEN points ELSE 0 END),0) FROM behavior_records WHERE student_id=1""")
           .fetchone()[0],30)
        self.assertEqual(self.db.execute("""SELECT COALESCE(SUM(CASE WHEN
           points<0 THEN -points WHEN affairs_category='adjustment' AND points>0
           THEN -points ELSE 0 END),0) FROM behavior_records WHERE student_id=1""")
           .fetchone()[0],8)

    def tearDown(self):
        self.db.close()

    def test_automatic_reminders_disabled_until_configured(self):
        row=self.db.execute("SELECT auto_enabled,reminder_time,weekdays FROM affairs_settings").fetchone()
        self.assertEqual(row,(0,'08:30','1,2,3,4,5'))

    def test_idempotent_manual_and_cron_reminders_are_separate(self):
        self.db.execute("""INSERT INTO affairs_attendance_reminders
            (classroom_id,school_date,kind,actor_id) VALUES(1,'2026-10-27','manual',2)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO affairs_attendance_reminders
                (classroom_id,school_date,kind,actor_id) VALUES(1,'2026-10-27','manual',2)""")
        self.db.execute("""INSERT INTO affairs_attendance_reminders
            (classroom_id,school_date,kind) VALUES(1,'2026-10-27','auto')""")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM affairs_attendance_reminders").fetchone()[0],2)

    def test_grade_heads_reference_staff_accounts_without_changing_user_role(self):
        self.db.execute("INSERT INTO affairs_grade_heads(grade,teacher_user_id,updated_by) VALUES(3,1,2)")
        self.assertEqual(self.db.execute("SELECT teacher_user_id FROM affairs_grade_heads WHERE grade=3").fetchone(),(1,))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("INSERT INTO affairs_grade_heads(grade,teacher_user_id) VALUES(7,1)")

    def test_school_policy_requires_correct_score_sign_and_level(self):
        for category,pts in [('good',5),('minor',-2),('moderate',-4),
                             ('serious',-8),('very_serious',-12)]:
            self.db.execute("""INSERT INTO affairs_behavior_rules(name,category,points)
                VALUES(?,?,?)""",(category,category,pts))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM affairs_behavior_rules").fetchone()[0],5)
        for category,pts in [('minor',5),('good',-1),('moderate',0),('very_serious',-55)]:
            with self.assertRaises(sqlite3.IntegrityError):
                self.db.execute("""INSERT INTO affairs_behavior_rules(name,category,points)
                    VALUES('test',?,?)""",(category,pts))

    def test_score_ledger_links_to_existing_portal_totals(self):
        rule=self.db.execute("SELECT id FROM affairs_behavior_rules LIMIT 1").fetchone()
        if rule is None:
            self.db.execute("INSERT INTO affairs_behavior_rules(name,category,points) VALUES('test','minor',-2)")
            rule=self.db.execute("SELECT id FROM affairs_behavior_rules LIMIT 1").fetchone()
        self.db.execute("""INSERT INTO behavior_records
            (student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
            VALUES(1,-2,'บันทึกตามเกณฑ์',2,?,'minor')""",(rule[0],))
        self.assertEqual(self.db.execute("SELECT SUM(points) FROM behavior_records WHERE student_id=1").fetchone()[0],-2)

    def test_reprimand_and_probation_cases_have_independent_states_and_logs(self):
        self.db.execute("""INSERT INTO affairs_disciplinary_cases
            (student_id,measure,school_date,details,recorded_by)
            VALUES(1,'reprimand','2026-10-27','ตรวจสอบข้อเท็จจริงแล้ว',2)""")
        self.db.execute("""INSERT INTO affairs_disciplinary_cases
            (student_id,measure,school_date,details,recorded_by)
            VALUES(1,'probation','2026-10-27','บันทึกข้อตกลง',2)""")
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM affairs_disciplinary_cases").fetchone()[0],2)
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO affairs_disciplinary_cases
             (student_id,measure,school_date,details,recorded_by)
             VALUES(1,'invalid','2026-10-27','เหตุการณ์',2)""")
        self.db.execute("UPDATE affairs_disciplinary_cases SET state='resolved' WHERE measure='reprimand'")
        self.assertEqual(self.db.execute("SELECT state FROM affairs_disciplinary_cases WHERE measure='reprimand'").fetchone(),('resolved',))

if __name__=='__main__':
    unittest.main()
