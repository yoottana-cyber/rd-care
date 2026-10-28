"""Term-scoped schedule migration: historical foreign keys, self-serve activation, SQL race protection."""
import pathlib
import sqlite3
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1] / 'worker' / 'migrations'

class TermTimetableMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in (
            '0001_initial.sql','0002_notification_outbox.sql','0003_student_transfer_plans.sql',
            '0004_historical_enrollments.sql','0007_teacher_timetable.sql',
            '0008_teacher_timetable_approvals.sql','0009_teacher_timetable_immediate.sql',
            '0024_school_settings.sql'
        ):
            self.db.executescript((ROOT/name).read_text(encoding='utf-8'))
        self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(1,'teacher','Teacher','teacher','s','h')")
        self.db.execute("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(2,'teacher2','Teacher2','teacher','s','h')")
        self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'M1/1')")
        self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(2,1,2,'M1/2')")
        self.db.execute("INSERT INTO students(id,student_no,classroom_id,roll_no,full_name) VALUES(1,'S01',1,1,'Student')")
        self.db.execute("INSERT INTO timetable(id,classroom_id,teacher_user_id,day_of_week,period,subject) VALUES(7,1,1,1,1,'Legacy')")
        self.db.execute("INSERT INTO attendance_period(student_id,timetable_id,school_date,status,recorded_by) VALUES(1,7,'2026-10-26','present',1)")
        self.db.commit()
        # Model D1 transaction: defer foreign key checks until the old table name
        # has been restored with original IDs and parent relationships.
        sql=(ROOT/'0026_timetable_terms.sql').read_text(encoding='utf-8')
        self.db.executescript('BEGIN;\n'+sql+'\nCOMMIT;')

    def tearDown(self):
        self.db.close()

    def add(self, classroom=1, teacher=1, period=1, end_period=1, year=2569, term=2):
        return self.db.execute("""INSERT INTO timetable
         (classroom_id,teacher_user_id,day_of_week,period,end_period,subject_code,subject,
          active,approval_status,academic_year,semester)
         VALUES(?,?,?,?,?,'SCI','New',1,'approved',?,?)""",
         (classroom,teacher,1,period,end_period,year,term))

    def test_migrates_old_ids_and_preserves_attendance_foreign_key(self):
        self.assertEqual(self.db.execute(
         'SELECT id,academic_year,semester FROM timetable WHERE id=7').fetchone(),
         (7,2569,2))
        self.assertEqual(self.db.execute(
         'SELECT timetable_id,status FROM attendance_period').fetchone(),(7,'present'))
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])
        self.assertEqual(self.db.execute(
         'SELECT subject FROM timetable WHERE id=7').fetchone()[0],'Legacy')

    def test_new_term_can_reuse_same_room_day_period_without_touching_old_attendance(self):
        self.add(year=2570,term=1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM timetable').fetchone()[0],2)
        self.assertEqual(self.db.execute(
         'SELECT status FROM attendance_period WHERE timetable_id=7').fetchone()[0],'present')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_same_room_overlapping_pair_is_rejected_but_adjacent_is_allowed(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
            self.add(classroom=1,teacher=2,period=1,end_period=2)
        self.add(classroom=1,teacher=2,period=2,end_period=3)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
            self.add(classroom=1,teacher=2,period=3,end_period=4)

    def test_same_teacher_two_rooms_same_time_rejected(self):
        with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
            self.add(classroom=2,teacher=1,period=1)
        self.add(classroom=2,teacher=1,period=2)
        with self.assertRaisesRegex(sqlite3.IntegrityError,'TIMETABLE_OVERLAP'):
            self.db.execute('UPDATE timetable SET period=1 WHERE classroom_id=2 AND period=2')

    def test_old_course_can_be_inactivated_without_destroying_history(self):
        self.db.execute("UPDATE timetable SET active=0,approval_status='archived' WHERE id=7")
        self.add(classroom=1,teacher=2,period=1,end_period=1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM attendance_period').fetchone()[0],1)
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

if __name__=='__main__':
    unittest.main()
