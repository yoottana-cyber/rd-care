import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {parseCriteriaExcelRows} from '../web/criteria-excel-import.js';
import {normalizeCriteriaRows,criteriaImportRoutes} from '../worker/src/criteria-excel-import.js';
import {recordBehaviorBulk} from '../worker/src/behavior-bulk.js';
import {studentAffairsRoutes} from '../worker/src/student-affairs.js';
import {buildCriteriaExampleXlsx} from '../web/template-xlsx.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const teacher={id:8,role:'teacher',student_affairs:1};
const row=(category,points)=>({row_no:2,rule_id:null,category,name:'เกณฑ์ทดสอบคะแนนสูง',points,active:1});
const post=(path,body)=>new Request('https://rd-care.test'+path,{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
});
test('Excel client and Worker accept large approved merit/conduct values without +/-50 ceiling',()=>{
 for(const [mode,category,points] of [
  ['good','good',80],['good','good',100000],
  ['behavior','minor',-80],['behavior','serious',-5000],
  ['behavior','very_serious',-100000]
 ]){
  const record=row(category,points);
  const x=parseCriteriaExcelRows([
   ['rule_id','category','name','points','active'],
   ['',category,record.name,points,1]
  ],mode);
  assert.equal(x.length,1);
  assert.equal(x[0].error,'',JSON.stringify(x[0]));
  assert.equal(x[0].points,points);
  assert.equal(normalizeCriteriaRows({mode,rows:[record]})[0].error,'');
 }
});
test('non-integers, zero, wrong-sign and unsafe huge values are still rejected',()=>{
 for(const [mode,category,points] of [
  ['good','good',0],['good','good',-80],
  ['behavior','minor',80],['behavior','serious',12.5],
  ['good','good',Number.MAX_SAFE_INTEGER+1]
 ]){
  const x=normalizeCriteriaRows({mode,rows:[row(category,points)]});
  assert.ok(x[0].error,JSON.stringify(x[0]));
 }
});
test('school criteria import preview accepts 80 and 1000 with correct categories',async()=>{
 const rules=[];
 const env={DB:{prepare(sql){return {
  all:async()=>({results:rules}),
  bind(){return {all:async()=>({results:rules})}}
 }}}};
 for(const [mode,category,points] of [['good','good',1000],['behavior','serious',-80]]){
  const path='/api/affairs/behavior/rules/import/preview';
  const res=await criteriaImportRoutes(env,teacher,path,{mode,rows:[row(category,points)]});
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).items.map(x=>[x.status,x.error]),[['create','']]);
 }
});
test('bulk student recording accepts active rule with -80 and +120 points',async()=>{
 for(const [category,points] of [['serious',-80],['good',120]]){
  const calls=[],batches=[];
  const DB={
   prepare(sql){
    const item={sql,args:[]};calls.push(item);
    return {bind(...args){item.args=args;return {
     first:async()=>({id:3,category,points,name:'โรงเรียนอนุมัติ',active:1}),
     all:async()=>({results:sql.includes('FROM behavior_incidents')?
      [{id:100,student_id:12,affairs_rule_id:3,affairs_category:category,
       points_applied:points,warning_no:0,behavior_record_id:200}]:[{id:12}]})
    }}};
   },
   batch:async arr=>{batches.push(arr);return arr.map((item,index)=>index===arr.length-1?
    {success:true,results:[{id:100,student_id:12,affairs_rule_id:3,
     reason:'โรงเรียนอนุมัติ',affairs_category:category,points_applied:points,
     warning_no:0,behavior_record_id:200}]}:{success:true,meta:{changes:4,last_row_id:200}})}
  };
  const permitted=category==='good'?teacher:{role:'teacher',id:8,student_affairs:1};
  const res=await recordBehaviorBulk({DB},permitted,{student_ids:[12],rule_id:3,reason:''});
  assert.equal(res.status,201);
  assert.equal((await res.json()).points,points);
  assert.match(calls.find(x=>x.sql.includes('INSERT OR IGNORE INTO behavior_incidents')).sql,/points_applied/);
  assert.equal(batches[0].length,2); // write + transactional receipt lookup
 }
});
test('manual school criteria management accepts unrestricted signed integer points',async()=>{
 const actor={id:8,role:'staff'};
 for(const [category,points] of [['good',500],['serious',-80]]){
  const calls=[],DB={prepare(sql){
   const q={sql,args:[]};calls.push(q);
   return {bind(...args){q.args=args;return {
    run:async()=>({meta:{last_row_id:100,changes:1}})
   }}};
  }};
  const path='/api/affairs/behavior/rules';
  const res=await studentAffairsRoutes(post(path,{
    name:'เกณฑ์ตัวอย่างคะแนนไม่จำกัด',category,points,active:true
  }),{DB},actor,path);
  assert.equal(res.status,200);
  assert.ok(calls.find(x=>x.sql.includes('INSERT INTO affairs_behavior_rules')));
  assert.equal(calls.find(x=>x.sql.includes('INSERT INTO affairs_behavior_rules')).args[2],points);
 }
});
test('XLSX sample, UI input and scorer validators do not advertise hard 50-point ceiling',()=>{
 const tmpl=read('web/template-xlsx.js');
 const ui=read('web/student-affairs.js'),web=read('web/criteria-excel-import.js');
 const backend=read('worker/src/criteria-excel-import.js');
 const bulk=read('worker/src/behavior-bulk.js');
 assert.match(tmpl,/ไม่จำกัดคะแนนสูงสุด/);
 assert.match(ui,/isAdjustment\?'min="1" max="50"':isGood\?'min="1"':'max="-1"'/);
 assert.doesNotMatch(web,/Math\.abs\(points\)>50/);
 assert.doesNotMatch(backend,/Math\.abs\(points\)>50/);
 assert.doesNotMatch(bulk,/Math\.abs\(points\)>50/);
 for(const mode of ['good','behavior']){
  assert.ok(buildCriteriaExampleXlsx(mode).byteLength>1000);
 }
});
test('SQLite migration rebuilds both tables, preserves history and foreign keys, and removes score checks',()=>{
 const script=String.raw`
import sqlite3
from pathlib import Path
p=Path('worker/migrations/0040_unbounded_conduct_merit_scores.sql').read_text(encoding='utf8')
c=sqlite3.connect(':memory:');c.execute('PRAGMA foreign_keys=ON')
c.executescript("""
CREATE TABLE users(id INTEGER PRIMARY KEY);
CREATE TABLE students(id INTEGER PRIMARY KEY);
CREATE TABLE affairs_adjustment_rules(id INTEGER PRIMARY KEY, points INTEGER CHECK(points BETWEEN 1 AND 50));
CREATE TABLE affairs_behavior_rules(
 id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,
 category TEXT NOT NULL CHECK(category IN('good','minor','moderate','serious','very_serious')),
 points INTEGER NOT NULL CHECK(points BETWEEN -50 AND 50 AND points!=0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 updated_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK((category='good' AND points>0) OR (category!='good' AND points<0)));
CREATE INDEX idx_affairs_rules_category ON affairs_behavior_rules(category,active);
CREATE TABLE behavior_records(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 student_id INTEGER NOT NULL REFERENCES students(id),
 points INTEGER NOT NULL CHECK(points BETWEEN -50 AND 50 AND points != 0),
 reason TEXT NOT NULL,
 recorded_by INTEGER NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 affairs_rule_id INTEGER REFERENCES affairs_behavior_rules(id),
 affairs_category TEXT CHECK(affairs_category IS NULL OR affairs_category IN('good','minor','moderate','serious','very_serious','adjustment')),
 adjustment_rule_id INTEGER REFERENCES affairs_adjustment_rules(id),
 deleted_at TEXT,deleted_by INTEGER REFERENCES users(id));
CREATE INDEX idx_behavior_student ON behavior_records(student_id,created_at);
CREATE INDEX idx_behavior_affairs_student ON behavior_records(student_id,affairs_category,created_at);
CREATE INDEX idx_behavior_active_student ON behavior_records(student_id,deleted_at,created_at);
CREATE TABLE truancy_score_policy(id INTEGER PRIMARY KEY,rule_id INTEGER REFERENCES affairs_behavior_rules(id));
CREATE TABLE timetable(id INTEGER PRIMARY KEY,period INTEGER NOT NULL,end_period INTEGER);
CREATE TABLE truancy_behavior_links(
 student_id INTEGER NOT NULL REFERENCES students(id),
 timetable_id INTEGER NOT NULL REFERENCES timetable(id),
 school_date TEXT NOT NULL,behavior_record_id INTEGER NOT NULL UNIQUE REFERENCES behavior_records(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(student_id,timetable_id,school_date));
CREATE TABLE score_import_receipts(id INTEGER PRIMARY KEY,rule_id INTEGER REFERENCES affairs_behavior_rules(id),behavior_record_id INTEGER REFERENCES behavior_records(id));
CREATE TABLE affairs_criteria_import_receipts(id INTEGER PRIMARY KEY,rule_id INTEGER REFERENCES affairs_behavior_rules(id));
CREATE TABLE period_truancy(student_id INTEGER,timetable_id INTEGER,school_date TEXT,recorded_by INTEGER);
CREATE TABLE audit_logs(actor_id INTEGER,action TEXT,entity_type TEXT,entity_id TEXT);
INSERT INTO users(id) VALUES(1);
INSERT INTO students(id) VALUES(3);
INSERT INTO affairs_behavior_rules(id,name,category,points) VALUES(1,'หนีเรียน','moderate',-10),(2,'ช่วยงาน','good',5);
INSERT INTO behavior_records(id,student_id,points,reason,recorded_by,affairs_rule_id,affairs_category)
 VALUES(99,3,-10,'เดิม',1,1,'moderate'),(100,3,5,'ความดีเก่า',1,2,'good');
INSERT INTO truancy_score_policy(id,rule_id) VALUES(1,1);
INSERT INTO timetable(id,period,end_period) VALUES(17,2,2);
INSERT INTO truancy_behavior_links(student_id,timetable_id,school_date,behavior_record_id)
 VALUES(3,17,'2026-10-28',99);
INSERT INTO score_import_receipts(id,rule_id,behavior_record_id) VALUES(1,2,100);
INSERT INTO affairs_criteria_import_receipts(id,rule_id) VALUES(1,2);
""")
c.execute('PRAGMA foreign_keys=ON')
try:
 c.executescript('BEGIN;\n'+p+'\nCOMMIT;')
except Exception as ex:
 raise AssertionError('Failed migration with foreign keys enabled: '+str(ex))
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
assert c.execute('SELECT id,points FROM behavior_records ORDER BY id').fetchall()==[(99,-10),(100,5)]
assert c.execute('SELECT rule_id FROM truancy_score_policy').fetchone()==(1,)
assert c.execute('SELECT behavior_record_id FROM score_import_receipts').fetchone()==(100,)
assert c.execute('SELECT rule_id FROM affairs_criteria_import_receipts').fetchone()==(2,)
c.execute("INSERT INTO affairs_behavior_rules(name,category,points) VALUES('หนัก','serious',-80)")
c.execute("INSERT INTO affairs_behavior_rules(name,category,points) VALUES('ดี','good',999)")
c.execute("INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_rule_id,affairs_category) VALUES(3,-80,'ทดสอบ',1,3,'serious')")
c.execute("INSERT INTO behavior_records(student_id,points,reason,recorded_by,affairs_rule_id,affairs_category) VALUES(3,999,'ทดสอบ',1,4,'good')")
c.execute("INSERT INTO period_truancy(student_id,timetable_id,school_date,recorded_by) VALUES(3,17,\'2026-10-29\',1)")
assert c.execute('SELECT points FROM behavior_records WHERE reason LIKE \'หนีเรียน วันที่ %\'').fetchone()==(-10,)
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
assert sorted([x[0] for x in c.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_behavior_%'")])==[
 'idx_behavior_active_student','idx_behavior_affairs_student','idx_behavior_student']
for name in ('affairs_behavior_rules','behavior_records'):
 schema=c.execute('SELECT sql FROM sqlite_master WHERE name=?',(name,)).fetchone()[0]
 assert 'BETWEEN -50 AND 50' not in schema
print('Migration preserves original scores, FKs, linked truancy, historical receipts and accepts large points')
`;
 const result=spawnSync('python3',['-c',script],{encoding:'utf8',cwd:new URL('..',import.meta.url).pathname});
 assert.equal(result.status,0,JSON.stringify({stdout:result.stdout,stderr:result.stderr}));
});
