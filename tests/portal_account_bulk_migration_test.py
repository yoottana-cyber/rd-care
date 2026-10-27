import sqlite3
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[1]
class PortalAccountUpsertSchema(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        for name in ['worker/migrations/0001_initial.sql',
                     'worker/migrations/0006_student_guardian_portal.sql']:
            self.db.executescript((ROOT/name).read_text(encoding='utf-8'))
        self.db.execute("""INSERT INTO users(id,username,display_name,role,password_salt,password_hash)
            VALUES(1,'admin','Admin','admin','salt','hash')""")
        self.db.execute("""INSERT INTO classrooms(id,grade,room,label)
            VALUES(1,2,1,'ม.2/1')""")
        self.db.execute("""INSERT INTO students(id,student_no,classroom_id,roll_no,full_name)
            VALUES(1,'000001',1,1,'นักเรียนหนึ่ง'),(2,'000002',1,2,'นักเรียนสอง')""")
    def tearDown(self):
        self.db.close()
    def test_existing_accounts_no_longer_force_password_change(self):
        self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,
            password_salt,password_hash,created_by)
            VALUES('000001','นักเรียนหนึ่ง','student',1,'salt','hash',1)""")
        self.assertEqual(self.db.execute('SELECT must_change_password FROM portal_accounts').fetchone(),(1,))
        migration=(ROOT/'worker/migrations/0021_portal_no_forced_password_rotation.sql').read_text(encoding='utf-8')
        self.db.executescript(migration)
        self.assertEqual(self.db.execute('SELECT must_change_password FROM portal_accounts').fetchone(),(0,))
    def test_student_no_is_stable_and_reimport_keeps_single_account(self):
        self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,
            password_salt,password_hash,must_change_password,created_by)
            VALUES('000001','เดิม','student',1,'salt','oldhash',0,1)""")
        self.db.execute("""UPDATE portal_accounts
            SET display_name='ชื่อใหม่',active=1,must_change_password=0
            WHERE student_id=1 AND role='student'""")
        self.assertEqual(self.db.execute("""SELECT COUNT(*) FROM portal_accounts
            WHERE student_id=1""").fetchone()[0],1)
        self.assertEqual(self.db.execute("""SELECT display_name,password_hash
            FROM portal_accounts WHERE student_id=1""").fetchone(),('ชื่อใหม่','oldhash'))
    def test_guardian_links_upsert_for_same_number_without_duplicates(self):
        self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,
            password_salt,password_hash,must_change_password,created_by)
            VALUES('parentone','ผู้ปกครอง','guardian','salt','hash',0,1)""")
        statement="""INSERT INTO guardian_student_links
         (guardian_account_id,student_id,verified_by)
         SELECT a.id,?,? FROM portal_accounts a WHERE a.username=? AND a.role='guardian'
         ON CONFLICT(guardian_account_id,student_id) DO UPDATE SET verified_by=excluded.verified_by"""
        self.db.execute(statement,(1,1,'parentone'))
        self.db.execute(statement,(1,1,'parentone'))
        self.db.execute(statement,(2,1,'parentone'))
        self.assertEqual(self.db.execute("""SELECT COUNT(*) FROM guardian_student_links""").fetchone()[0],2)
    def test_student_cannot_impersonate_guardian_with_username_collision(self):
        self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,student_id,
            password_salt,password_hash,must_change_password,created_by)
            VALUES('000001','นักเรียน','student',1,'salt','hash',0,1)""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("""INSERT INTO portal_accounts(username,display_name,role,
                password_salt,password_hash,must_change_password,created_by)
                VALUES('000001','ผู้ปกครอง','guardian','salt','hash',0,1)""")
if __name__=='__main__':
    unittest.main()
