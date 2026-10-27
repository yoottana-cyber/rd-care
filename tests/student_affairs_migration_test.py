import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]

class StudentAffairsSchema(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for filename in ['worker/migrations/0001_initial.sql',
                         'worker/migrations/0018_student_affairs.sql']:
            self.db.executescript((ROOT/filename).read_text(encoding='utf-8'))
        self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
            VALUES(1,'teacher1','ครูที่ปรึกษา','teacher','x','x'),
            (2,'staff1','กิจการนักเรียน','staff','x','x')""")
        self.db.execute("""INSERT INTO classrooms(id,grade,room,label,advisor_user_id)
            VALUES(1,3,1,'ม.3/1',1)""")
        self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
            VALUES(1,'1234',1,1,'นักเรียนทดสอบ')""")

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
