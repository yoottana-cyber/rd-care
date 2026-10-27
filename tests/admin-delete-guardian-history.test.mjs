import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminDeleteIdentity} from '../worker/src/admin-delete.js';

const route=(path,confirm)=>new Request('https://rd-care.test'+path,{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm})});
const admin={id:1,role:'admin'};
function fakeDb({staff,student,portal}={}){
 const calls=[],batches=[];
 const DB={
  prepare(sql){
   const args={sql,values:[]};
   calls.push(args);
   return {bind(...values){args.values=values;
    return {first:async()=>{
     if(sql.includes('FROM users WHERE id=?'))return staff??null;
     if(sql.includes('FROM students WHERE id=?'))return student??null;
     if(sql.includes('FROM portal_accounts WHERE id=?'))return portal??null;
     return null;
    }};
   }};
  },
  batch:async statements=>{batches.push(statements);return statements.map(()=>({meta:{changes:1}}))}
 };
 return {DB,calls,batches};
}
test('only Admin can remove staff, students or guardians',async()=>{
 const env=fakeDb();
 for(const path of ['/api/admin/users/2/delete','/api/admin/students/3/delete',
   '/api/admin/portal/accounts/4/delete']){
  await assert.rejects(()=>adminDeleteIdentity(route(path,'x'),env,{id:5,role:'teacher'},path),{code:403});
 }
 assert.equal(env.calls.length,0);
});
test('admin account and wrong username cannot be deleted',async()=>{
 const env=fakeDb({staff:{id:1,role:'admin',username:'admin',deleted_at:null}});
 await assert.rejects(()=>adminDeleteIdentity(route('/api/admin/users/1/delete','admin'),
   env,admin,'/api/admin/users/1/delete'),{code:403});
 const teacher=fakeDb({staff:{id:2,role:'teacher',username:'teacher01',deleted_at:null}});
 await assert.rejects(()=>adminDeleteIdentity(route('/api/admin/users/2/delete','notuser'),
   teacher,admin,'/api/admin/users/2/delete'),{code:400});
 assert.equal(teacher.batches.length,0);
});
test('teacher removal revokes sessions, classes and Student Affairs access while retaining educational records',async()=>{
 const env=fakeDb({staff:{id:8,role:'teacher',username:'teacher08',deleted_at:null}});
 const path='/api/admin/users/8/delete';
 const result=await adminDeleteIdentity(route(path,'teacher08'),env,admin,path);
 const json=await result.json();
 assert.equal(json.kind,'archived');
 const sql=env.calls.map(x=>x.sql).join('\n');
 for(const term of ['UPDATE users SET active=0','DELETE FROM sessions',
  'DELETE FROM staff_push_subscriptions','DELETE FROM student_affairs_assignments',
  'DELETE FROM affairs_grade_heads','UPDATE classrooms SET advisor_user_id=NULL',
  'UPDATE timetable SET active=0','personnel_archived'])
   assert.ok(sql.includes(term),term);
 assert.doesNotMatch(sql,/DELETE FROM (attendance_daily|behavior_records|users)/);
});
test('student removal revokes login and guardian links but keeps school attendance/score records',async()=>{
 const env=fakeDb({student:{id:9,student_no:'000009',full_name:'นักเรียนเดิม',deleted_at:null}});
 const path='/api/admin/students/9/delete';
 const result=await adminDeleteIdentity(route(path,'000009'),env,admin,path);
 assert.equal((await result.json()).kind,'archived');
 const sql=env.calls.map(x=>x.sql).join('\n');
 for(const term of ['DELETE FROM guardian_student_links',
  'DELETE FROM portal_accounts WHERE student_id','UPDATE students SET active=0','student_archived'])
  assert.ok(sql.includes(term),term);
 assert.doesNotMatch(sql,/DELETE FROM (attendance_daily|attendance_period|behavior_records|students)/);
});
test('portal guardian deletion removes logins and links without touching students',async()=>{
 const env=fakeDb({portal:{id:10,username:'parent10',role:'guardian'}});
 const path='/api/admin/portal/accounts/10/delete';
 const result=await adminDeleteIdentity(route(path,'parent10'),env,admin,path);
 assert.equal((await result.json()).kind,'deleted');
 const sql=env.calls.map(x=>x.sql).join('\n');
 for(const term of ['DELETE FROM portal_sessions','DELETE FROM guardian_student_links',
  'DELETE FROM guardian_push_subscriptions','DELETE FROM portal_accounts WHERE id'])
  assert.ok(sql.includes(term),term);
 assert.doesNotMatch(sql,/DELETE FROM (students|attendance_daily|behavior_records)/);
});
test('guardian history shows separate attendance, truancy, misconduct and merit with explicit verified-link scope',()=>{
 const ui=readFileSync(new URL('../web/portal-ui.js',import.meta.url),'utf8');
 const portal=readFileSync(new URL('../worker/src/portal.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../worker/src/worker.js',import.meta.url),'utf8');
 for(const key of ['truancyHistory','behaviorHistory','คะแนนความผิดสะสม',
  'คะแนนความดี','30 วันล่าสุด','rd-portal-score-cards'])assert.ok(ui.includes(key),key);
 for(const term of ['guardian_student_links','truancy:(period.results||[]).filter',
   'behavior_deducted','behavior_adjusted','behavior_remaining','good_total'])assert.ok(portal.includes(term),term);
 assert.match(worker,/deleted_at IS NULL ORDER BY u.display_name/);
 assert.match(worker,/classroom_id=\? AND deleted_at IS NULL ORDER BY active DESC/);
});
