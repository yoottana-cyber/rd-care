"""SQLite/D1-safe regression: immutable term snapshots preserve history and foreign keys."""
import pathlib, sqlite3, unittest

DIR = pathlib.Path(__file__).resolve().parents[1] / "worker" / "migrations"

class TermSnapshotsMigrationTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys = ON')
        files=[
            '0001_initial.sql','0002_notification_outbox.sql',
            '0003_student_transfer_plans.sql','0004_historical_enrollments.sql',
            '0007_teacher_timetable.sql','0008_teacher_timetable_approvals.sql',
            '0009_teacher_timetable_immediate.sql','0024_school_settings.sql',
            '0025_school_term_snapshots.sql'
        ]
        for file in files:
            self.db.executescript((DIR/file).read_text(encoding='utf-8'))
        self.db.execute("""INSERT INTO users
            (id,username,display_name,role,password_salt,password_hash)
            VALUES(1,'administrator','Admin','admin','s','h')""")
        self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(1,1,1,'M.1/1')")
        self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
            VALUES(1,'S001',1,1,'Sample Student')""")
        self.db.execute("""INSERT INTO student_enrollments(student_id,classroom_id,roll_no,start_date)
            VALUES(1,1,1,'2026-05-01')""")
        self.db.execute("""INSERT INTO timetable
            (id,classroom_id,teacher_user_id,day_of_week,period,subject)
            VALUES(5,1,1,1,1,'Computer')""")
        self.db.execute("""INSERT INTO attendance_period
            (student_id,timetable_id,school_date,status,recorded_by)
            VALUES(1,5,'2026-10-26','present',1)""")

    def tearDown(self):
        self.db.close()

    def capture(self,year,semester,date):
        d=self.db
        d.execute("""INSERT INTO school_term_snapshots
          (academic_year,semester,snapshot_date,captured_by) VALUES(?,?,?,1)""",
          (year,semester,date))
        d.execute("""INSERT INTO school_term_roster
          (academic_year,semester,student_id,classroom_id,roll_no)
          SELECT ?,?,student_id,classroom_id,roll_no FROM student_enrollments
          WHERE start_date<=? AND (end_date IS NULL OR end_date>?)""",
          (year,semester,date,date))
        d.execute("""INSERT INTO school_term_lessons
          (academic_year,semester,original_timetable_id,classroom_id,teacher_user_id,
           day_of_week,period,end_period,subject_code,subject)
          SELECT ?,?,id,classroom_id,teacher_user_id,day_of_week,period,
           COALESCE(end_period,period),subject_code,subject FROM timetable WHERE active=1""",
          (year,semester))

    def test_capture_is_term_scoped_and_keeps_attendance_foreign_keys(self):
        self.capture(2569,2,'2026-10-28')
        self.db.execute("UPDATE timetable SET subject='Changed next term' WHERE id=5")
        self.capture(2570,1,'2027-05-01')
        history=self.db.execute("""SELECT academic_year,semester,subject FROM school_term_lessons
          ORDER BY academic_year,semester""").fetchall()
        self.assertEqual(history,[(2569,2,'Computer'),(2570,1,'Changed next term')])
        self.assertEqual(self.db.execute(
            'SELECT status FROM attendance_period WHERE timetable_id=5'
        ).fetchone()[0],'present')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_second_capture_cannot_replace_existing_reference(self):
        self.capture(2569,2,'2026-10-28')
        with self.assertRaises(sqlite3.IntegrityError):
            self.capture(2569,2,'2026-10-29')
        self.assertEqual(self.db.execute(
            "SELECT subject FROM school_term_lessons WHERE academic_year=2569"
        ).fetchone()[0],'Computer')

    def test_roster_snapshot_survives_current_room_and_roll_changes(self):
        self.db.execute("INSERT INTO classrooms(id,grade,room,label) VALUES(2,1,2,'M.1/2')")
        self.capture(2569,2,'2026-10-28')
        self.db.execute("""UPDATE student_enrollments SET end_date='2027-05-01'
          WHERE student_id=1 AND end_date IS NULL""")
        self.db.execute("""INSERT INTO student_enrollments
          (student_id,classroom_id,roll_no,start_date) VALUES(1,2,4,'2027-05-01')""")
        self.db.execute("UPDATE students SET classroom_id=2,roll_no=4 WHERE id=1")
        old=self.db.execute("""SELECT classroom_id,roll_no FROM school_term_roster
          WHERE academic_year=2569 AND semester=2 AND student_id=1""").fetchone()
        self.assertEqual(old,(1,1))
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

if __name__=='__main__':unittest.main()
