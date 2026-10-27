-- RD CONNECT / Student Affairs: role uses existing staff accounts, no login migration.
-- Defaults do not invent school conduct deductions; staff configure each rule.
CREATE TABLE IF NOT EXISTS affairs_settings (
 id INTEGER PRIMARY KEY CHECK(id=1),
 auto_enabled INTEGER NOT NULL DEFAULT 0 CHECK(auto_enabled IN(0,1)),
 reminder_time TEXT NOT NULL DEFAULT '08:30' CHECK(length(reminder_time)=5),
 weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO affairs_settings(id,auto_enabled,reminder_time,weekdays) VALUES(1,0,'08:30','1,2,3,4,5');
CREATE TABLE IF NOT EXISTS affairs_non_school_days (
 school_date TEXT PRIMARY KEY,
 label TEXT NOT NULL,
 created_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS affairs_grade_heads (
 grade INTEGER PRIMARY KEY CHECK(grade BETWEEN 1 AND 6),
 teacher_user_id INTEGER NOT NULL REFERENCES users(id),
 updated_by INTEGER REFERENCES users(id),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS affairs_attendance_reminders (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 classroom_id INTEGER NOT NULL REFERENCES classrooms(id),
 school_date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('manual','auto')),
 actor_id INTEGER REFERENCES users(id),
 attempted INTEGER NOT NULL DEFAULT 0,
 delivered INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sent','no_subscription','failed')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(classroom_id,school_date,kind)
);
CREATE INDEX IF NOT EXISTS idx_affairs_reminders_day ON affairs_attendance_reminders(school_date,kind,state);
CREATE TABLE IF NOT EXISTS affairs_behavior_rules (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN('good','minor','moderate','serious','very_serious')),
 points INTEGER NOT NULL CHECK(points BETWEEN -50 AND 50 AND points!=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 updated_by INTEGER REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((category='good' AND points>0) OR (category!='good' AND points<0))
);
CREATE INDEX IF NOT EXISTS idx_affairs_rules_category ON affairs_behavior_rules(category,active);
-- The canonical score and student/guardian totals stay in behavior_records.
ALTER TABLE behavior_records ADD COLUMN affairs_rule_id INTEGER REFERENCES affairs_behavior_rules(id);
ALTER TABLE behavior_records ADD COLUMN affairs_category TEXT CHECK(affairs_category IS NULL OR affairs_category IN('good','minor','moderate','serious','very_serious','adjustment'));
CREATE TABLE IF NOT EXISTS affairs_disciplinary_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 measure TEXT NOT NULL CHECK(measure IN('reprimand','probation')),
 school_date TEXT NOT NULL,
 details TEXT NOT NULL,
 conditions TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','resolved','cancelled')),
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 guardian_informed_date TEXT,
 guardian_ack_date TEXT,
 resolution TEXT NOT NULL DEFAULT '',
 reviewed_by INTEGER REFERENCES users(id),
 reviewed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_affairs_cases_student ON affairs_disciplinary_cases(student_id,school_date);
