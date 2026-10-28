import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EXPECTED_DB_NAME,EXPECTED_DB_ID,MARKER,isLegacyStudents,planTrialTableDrops}
 from '../worker/scripts/trial-db-reset-plan.mjs';

const schema=[
 {name:'users',type:'table',sql:'CREATE TABLE users(id INTEGER PRIMARY KEY)'},
 {name:'students',type:'table',sql:'CREATE TABLE students(id INTEGER PRIMARY KEY,classroom_id INTEGER REFERENCES classrooms(id),UNIQUE(classroom_id,roll_no))'},
 {name:'classrooms',type:'table',sql:'CREATE TABLE classrooms(id INTEGER PRIMARY KEY,advisor_user_id INTEGER REFERENCES users(id))'},
 {name:'attendance_daily',type:'table',sql:'CREATE TABLE attendance_daily(student_id INTEGER REFERENCES students(id),recorded_by INTEGER REFERENCES users(id))'},
 {name:'d1_migrations',type:'table',sql:'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY)'}
];
const allowed=new Set(schema.map(x=>x.name));
test('trial reset drops children before student, classroom, user and migration tables',()=>{
 const plan=planTrialTableDrops(schema,allowed);
 const p=n=>plan.indexOf('DROP TABLE IF EXISTS "'+n+'";');
 for(const [child,parent] of [
  ['attendance_daily','students'],['attendance_daily','users'],['students','classrooms'],
  ['classrooms','users'],['users','d1_migrations'],['students','d1_migrations']
 ])assert.ok(p(child)<p(parent),child+' before '+parent);
 assert.equal(plan.length,schema.length);
 assert(plan.every(sql=>/^DROP TABLE IF EXISTS "[A-Za-z_][A-Za-z0-9_]*";$/.test(sql)));
});
test('unknown tables, missing references and FK cycles abort before any DELETE',()=>{
 const unknown=[...schema,{name:'someone_elses_table',type:'table',sql:'CREATE TABLE someone_elses_table(id INTEGER)'}];
 assert.throws(()=>planTrialTableDrops(unknown,allowed),/Unknown D1 table/);
 assert.throws(()=>planTrialTableDrops([
  {name:'students',type:'table',sql:'CREATE TABLE students(id INTEGER REFERENCES unknown(id))'}
 ],allowed),/Unknown referenced table/);
 const cycle=[
  {name:'students',type:'table',sql:'CREATE TABLE students(x INTEGER REFERENCES classrooms(id))'},
  {name:'classrooms',type:'table',sql:'CREATE TABLE classrooms(x INTEGER REFERENCES students(id))'}
 ];
 assert.throws(()=>planTrialTableDrops(cycle,allowed),/Foreign-key cycle/);
});
test('archive room constraint and allowed D1 UUID are explicitly checked',()=>{
 assert(isLegacyStudents('CREATE TABLE students(UNIQUE(classroom_id,roll_no))'));
 assert(!isLegacyStudents('CREATE TABLE students(id INTEGER,student_no TEXT UNIQUE)'));
 assert.equal(EXPECTED_DB_NAME,'rd-care-dev');
 assert.equal(EXPECTED_DB_ID,'161c2fb5-cd80-42bd-bbab-28b5d61df3e0');
 assert.equal(MARKER,'rdcare_trial_reset_marker');
 const cli=readFileSync(new URL('../worker/scripts/reset-trial-d1-once.mjs',import.meta.url),'utf8');
 assert.match(cli,/RD_TRIAL_RESET_CONFIRMED/);
 assert.match(cli,/dbs\.some\(x=>x\.name===EXPECTED_DB_NAME&&x\.uuid===EXPECTED_DB_ID\)/);
 assert.match(cli,/planTrialTableDrops\(schema,allow\)/);
 assert.match(cli,/DROP TABLE IF EXISTS/);
 assert.doesNotMatch(cli,/wrangler.*d1 delete/);
});
