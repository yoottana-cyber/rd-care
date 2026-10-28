PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','staff','teacher')),
 password_salt TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
 username TEXT PRIMARY KEY,
 failures INTEGER NOT NULL DEFAULT 0,
 locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS classrooms (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 grade INTEGER NOT NULL CHECK(grade BETWEEN 1 AND 6),
 room INTEGER NOT NULL CHECK(room BETWEEN 1 AND 20),
 label TEXT NOT NULL UNIQUE,
 advisor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 UNIQUE(grade,room)
);
CREATE INDEX IF NOT EXISTS idx_classrooms_advisor ON classrooms(advisor_user_id);
CREATE TABLE IF NOT EXISTS students (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_no TEXT NOT NULL UNIQUE,
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 roll_no INTEGER NOT NULL CHECK(roll_no BETWEEN 1 AND 100),
 full_name TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_students_room ON students(classroom_id,active,roll_no);
CREATE TABLE IF NOT EXISTS timetable (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 teacher_user_id INTEGER NOT NULL REFERENCES users(id),
 day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
 period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 12),
 subject TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 UNIQUE(classroom_id,day_of_week,period)
);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON timetable(teacher_user_id,day_of_week,active);
CREATE TABLE IF NOT EXISTS attendance_daily (
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('present','absent','late','leave')),
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON attendance_daily(school_date,status);
CREATE TABLE IF NOT EXISTS attendance_period (
 student_id INTEGER NOT NULL REFERENCES students(id),
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('present','absent','late','leave')),
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,timetable_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_period_date ON attendance_period(school_date,timetable_id,status);
CREATE TABLE IF NOT EXISTS late_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 school_date TEXT NOT NULL,
 arrived_at TEXT NOT NULL,
 reason TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL CHECK(state IN ('pending','verified','rejected')) DEFAULT 'pending',
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 reviewed_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_late_date ON late_records(school_date,state);
CREATE TABLE IF NOT EXISTS behavior_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 points INTEGER NOT NULL CHECK(points BETWEEN -50 AND 50 AND points != 0),
 reason TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_behavior_student ON behavior_records(student_id,created_at);
CREATE TABLE IF NOT EXISTS attendance_alerts (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending_review' CHECK(state IN ('pending_review','confirmed','resolved')),
 reviewed_by INTEGER REFERENCES users(id),
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(student_id,timetable_id,school_date)
);
CREATE INDEX IF NOT EXISTS idx_alert_state ON attendance_alerts(state,school_date);
CREATE TABLE IF NOT EXISTS audit_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_id INTEGER REFERENCES users(id),
 action TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at);
