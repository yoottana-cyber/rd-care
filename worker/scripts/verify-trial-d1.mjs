// Read-only D1 schema verification after migrations/seed/deploy.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {EXPECTED_DB_ID,EXPECTED_DB_NAME,isLegacyStudents} from './trial-db-reset-plan.mjs';
const config=readFileSync('wrangler.toml','utf8');
if(!config.includes('database_id = "'+EXPECTED_DB_ID+'"')||
 !config.includes('database_name = "'+EXPECTED_DB_NAME+'"'))throw Error('Unexpected D1 binding');
const sql=[
 "SELECT (SELECT COUNT(*) FROM classrooms) AS rooms,",
 "(SELECT COUNT(*) FROM students) AS students,",
 "(SELECT COUNT(*) FROM users) AS users,",
 "(SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL) AS active_admins,",
 "(SELECT COUNT(*) FROM admin_recovery_state) AS recovery_used,",
 "(SELECT COUNT(*) FROM d1_migrations) AS migrations,",
 "(SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='uq_students_current_room_roll') AS index_ready,",
 "(SELECT sql FROM sqlite_master WHERE type='table' AND name='students') AS student_sql"
].join(' ');
const raw=execFileSync('npx',['--no-install','wrangler','d1','execute',
 EXPECTED_DB_NAME,'--remote','--json','--command',sql],{encoding:'utf8',timeout:180000});
const response=JSON.parse(raw.trim());
const outcome=Array.isArray(response)?response[0]:response;
const row=outcome?.results?.[0];
if(!outcome?.success||!row)throw Error('D1 schema read failed');
if(Number(row.rooms)!==48||Number(row.index_ready)!==1||
 !row.student_sql||isLegacyStudents(row.student_sql)||
 Number(row.migrations)<32)throw Error('Original D1 has not completed new roster migrations');
console.log('RD Care original D1 verified: 48 rooms, live-only unique roll index, '+
 row.migrations+' migrations, '+row.students+' students and '+row.users+' staff accounts.');
console.log('Admin recovery diagnostics (no account names): active_admins='+Number(row.active_admins)+', recovery_used='+Number(row.recovery_used));
