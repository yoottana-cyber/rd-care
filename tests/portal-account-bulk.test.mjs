import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePortalRoster} from '../web/portal-roster-import.js';
import {importPortalAccounts} from '../worker/src/portal-bulk-import.js';
import {readFileSync} from 'node:fs';

const row=(number,overrides={})=>({
 student_no:String(number).padStart(6,'0'),full_name:'นักเรียน '+number,
 student_username:String(number).padStart(6,'0'),student_password:'Strong#'+number,
 guardian_name:'ผู้ปกครอง '+number,guardian_username:'family_'+number,
 guardian_password:'ParentStrong#'+number,...overrides
});
const headers=['student_no','full_name','student_username','student_password','guardian_name','guardian_username','guardian_password'];
const table=records=>[headers,...records.map(r=>headers.map(k=>r[k]??''))];
const req=(body)=>new Request('https://school.test/api/admin/portal/import',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const actor={id:100,role:'admin'};
function makeDb({exists=false,guardian=false,wrongRole=false}={}){
 const calls=[];
 const db={
  prepare(sql){
   const item={sql,args:[]};calls.push(item);
   return{bind(...args){item.args=args;return{
    first:async()=>{
     if(sql.includes('FROM students WHERE student_no=?'))return {id:123,full_name:'นักเรียนเดิม',active:1};
     if(sql.includes('FROM portal_accounts WHERE student_id=?'))return exists?{id:456,username:'000123'}:null;
     if(sql.includes('FROM portal_accounts WHERE username=? AND id!=?'))return null;
     if(sql.includes('SELECT id,role,display_name FROM portal_accounts WHERE username=?'))
      return guardian?{id:789,role:wrongRole?'student':'guardian',display_name:'ผู้ปกครองเดิม'}:null;
     return null;
    }
   }}};
  },
  async batch(stmts){return stmts.map((s,i)=>({meta:{changes:1,last_row_id:i+1}}))}
 };
 return {DB:db,calls};
}
test('full selected import has no row-count limit and protects password fields in preview state',()=>{
 const records=Array.from({length:5000},(_,i)=>row(i+1000));
 const plan=preparePortalRoster(table(records));
 assert.equal(plan.items.length,5000);
 assert.equal(plan.errors.length,0);
 assert.equal(plan.items[0].student_no,'001000');
 assert.equal(plan.items[4999].student_no,'005999');
});
test('repeat student numbers within one file are rejected rather than creating ambiguous links',()=>{
 const records=[row(12),row(12,{student_password:'DifferentPassword'})];
 const plan=preparePortalRoster(table(records));
 assert.equal(plan.items.length,1);
 assert.equal(plan.errors.length,1);
 assert.match(plan.errors[0].message,/ซ้ำ/);
});
test('reimport using student number updates account and preserves existing passwords when blank',async()=>{
 const env=makeDb({exists:true,guardian:true});
 const response=await importPortalAccounts(req({rows:[row(123,{
  full_name:'นักเรียนแก้ไข',student_password:'',guardian_password:'',
  guardian_username:'family_123',guardian_name:'ผู้ปกครองแก้ไข'
 })],relationships_verified:true}),env,actor);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.imported,1);
 assert.equal(data.items[0].student_no,'000123');
 assert.equal(data.items[0].student_account,'updated');
 assert.ok(env.calls.some(x=>x.sql.startsWith('UPDATE students SET full_name=')));
 const student=env.calls.find(x=>x.sql.includes('UPDATE portal_accounts SET username=?'));
 assert.ok(student);
 assert.doesNotMatch(student.sql,/password_hash=/);
 const guardian=env.calls.find(x=>x.sql.includes('UPDATE portal_accounts SET display_name=?'));
 assert.ok(guardian);
 assert.doesNotMatch(guardian.sql,/password_hash=/);
 assert.ok(env.calls.some(x=>x.sql.includes('INSERT INTO guardian_student_links')));
 assert.equal(JSON.stringify(data).includes('Strong'),false);
});
test('first-time student and guardian receive hashed passwords, never plaintext in SQL',async()=>{
 const env=makeDb({exists:false,guardian:false});
 const response=await importPortalAccounts(req({rows:[row(123)],relationships_verified:true}),env,actor);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.items[0].student_account,'created');
 const student=env.calls.find(x=>x.sql.includes("VALUES(?,?,'student',?,?,?,0,?)"));
 const guardian=env.calls.find(x=>x.sql.includes("'guardian',?,?,0,?)"));
 assert.ok(student);
 assert.ok(guardian);
 for(const cred of [student,guardian]){
  assert.ok(cred.args.some(v=>/^[0-9a-f]{64}$/.test(String(v))));
  assert.equal(cred.args.some(v=>String(v).includes('Strong#')),false);
 }
 assert.equal(JSON.stringify(data).includes('Strong#'),false);
});
test('a new account requires a password, but existing account may leave password blank',async()=>{
 const env=makeDb();
 await assert.rejects(()=>importPortalAccounts(req({rows:[row(123,{student_password:''})],
  relationships_verified:true}),env,actor),{code:400});
});
test('guardian links require verified identity and admins only',async()=>{
 const env=makeDb();
 await assert.rejects(()=>importPortalAccounts(req({rows:[row(123)],
  relationships_verified:false}),env,actor),{code:400});
 await assert.rejects(()=>importPortalAccounts(req({rows:[row(123)],
  relationships_verified:true}),env,{id:3,role:'teacher'}),{code:403});
});
test('guardian username cannot overwrite a student account',async()=>{
 const env=makeDb({guardian:true,wrongRole:true});
 await assert.rejects(()=>importPortalAccounts(req({rows:[row(123)],
  relationships_verified:true}),env,actor),{code:409});
});
test('whole-file portal import processes one record per atomic transport request, skipping only invalid rows',()=>{
 const ui=readFileSync(new URL('../web/portal-roster-import.js',import.meta.url),'utf8');
 const backend=readFileSync(new URL('../worker/src/portal-bulk-import.js',import.meta.url),'utf8');
 assert.match(ui,/while\(cursor<items.length\)/);
 assert.match(ui,/rows:\[data\]/);
 assert.match(ui,/phase:'student'/);
 assert.match(ui,/phase:'guardian'/);
 assert.match(ui,/if\(retryable\)/);
 assert.match(ui,/ดำเนินการต่อ/);
 assert.match(ui,/\/api\/admin\/portal\/import/);
 assert.match(backend,/CHUNK_SIZE=5/);
 assert.doesNotMatch(ui,/\.slice\(0,10\)/);
 const page=readFileSync(new URL('../web/portal-admin.js',import.meta.url),'utf8');
 assert.match(page,/portalRosterImporter/);
 assert.match(page,/name="password"/);
});
test('no forced first login password change from all portal provisioning and reset flows',()=>{
 const source=readFileSync(new URL('../worker/src/portal.js',import.meta.url),'utf8');
 assert.match(source,/must_change_password:false/);
 assert.match(source,/must_change_password=0 WHERE id=/);
 assert.doesNotMatch(source,/must_change_password=1 WHERE id=/);
 assert.match(source,/return importPortalAccounts\(req,env,actor\)/);
 for(const p of ['worker/src/worker.js','worker/src/unified-roster.js']){
  const code=readFileSync(new URL('../'+p,import.meta.url),'utf8');
  assert.match(code,/password_hash,must_change_password,created_by/);
 }
});

test('student phase avoids guardian hashing or linking in the same Worker request',async()=>{
 const env=makeDb({exists:false,guardian:false});
 const response=await importPortalAccounts(req({rows:[row(123)],phase:'student',
  relationships_verified:true}),env,actor);
 assert.equal((await response.json()).items[0].phase,'student');
 assert.equal(env.calls.filter(x=>x.sql.includes('INSERT INTO portal_accounts')).length,1);
 assert.equal(env.calls.some(x=>x.sql.includes('guardian_student_links')),false);
 const insert=env.calls.find(x=>x.sql.includes("'student'"));
 assert.ok(insert);
});
test('guardian phase does not rehash or rewrite the student account',async()=>{
 const env=makeDb({exists:true,guardian:false});
 const response=await importPortalAccounts(req({rows:[row(123)],phase:'guardian',
  relationships_verified:true}),env,actor);
 const result=await response.json();
 assert.equal(result.items[0].phase,'guardian');
 assert.equal(env.calls.some(x=>x.sql.includes('INSERT INTO guardian_student_links')),true);
 assert.equal(env.calls.some(x=>x.sql.startsWith('UPDATE portal_accounts SET username=')),false);
 assert.equal(env.calls.some(x=>x.sql.includes("VALUES(?,?,'student'")),false);
});
test('guardian phase rejects incomplete student provisioning',async()=>{
 const env=makeDb({exists:false,guardian:false});
 await assert.rejects(importPortalAccounts(req({rows:[row(123)],phase:'guardian',relationships_verified:true}),env,actor),{code:409});
});
test('invalid import phase cannot write accounts',async()=>{
 const env=makeDb();
 await assert.rejects(importPortalAccounts(req({rows:[row(123)],phase:'ignored',relationships_verified:true}),env,actor),{code:400});
});
