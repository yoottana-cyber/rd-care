'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {inspectAdvisorCoverage,run}=require('../advisor-check.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-advisor-gaps-'));
 const dir=path.join(root,'private');fs.mkdirSync(dir,{mode:0o700});
 const file=path.join(dir,'school.sqlite');
 migrate({filename:file,confirm:CONFIRM,log(){}});
 const env={RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
  RD_APP_MOUNT:'/web/rd-connect-fast',RD_SQLITE_FILE:file};
 return {file,dir,env,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('read-only check reports 48 unassigned rooms without printing student identities',()=>{
 const f=fixture();try{
  const before=fs.statSync(f.file).mtimeMs,logs=[];
  const result=run({env:f.env,log:x=>logs.push(x)});
  assert.equal(result.ready,false);
  assert.equal(result.total,48);
  assert.equal(result.unassigned.length,48);
  assert.equal(result.invalid.length,0);
  assert.equal(fs.statSync(f.file).mtimeMs,before);
  assert.ok(logs.some(x=>x.includes('NO DATA CHANGED')));
  assert.ok(logs.every(x=>!x.includes(f.file)));
 }finally{f.cleanup()}
});
test('reports single missing classroom and records 1- vs 2-advisor coverage',()=>{
 const f=fixture();try{
  const db=new DatabaseSync(f.file);
  try{
   db.exec("INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES ('synthetic_a','Synthetic A','teacher','x','x',1),('synthetic_b','Synthetic B','teacher','x','x',1)");
   const [a,b]=db.prepare("SELECT id FROM users WHERE username LIKE 'synthetic_%' ORDER BY username").all().map(x=>x.id);
   const ids=db.prepare("SELECT id FROM classrooms ORDER BY id").all().map(x=>x.id);
   const one=db.prepare('UPDATE classrooms SET advisor_user_id=? WHERE id=?');
   for(const id of ids.slice(0,-1))one.run(a,id);
   db.prepare('UPDATE classrooms SET advisor2_user_id=? WHERE id=?').run(b,ids[0]);
  }finally{db.close()}
  const logs=[],result=run({env:f.env,log:x=>logs.push(x)});
  assert.equal(result.total,48);
  assert.equal(result.covered,47);
  assert.equal(result.oneAdvisor,46);
  assert.equal(result.twoAdvisors,1);
  assert.equal(result.unassigned.length,1);
  assert.equal(result.invalid.length,0);
  assert.ok(logs.some(x=>x.startsWith('ASSIGN ADVISOR: ')));
 }finally{f.cleanup()}
});
test('inactive and duplicate advisor assignment is flagged, not counted as covered',()=>{
 const f=fixture();try{
  const db=new DatabaseSync(f.file);
  try{
   db.exec("INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES ('inactive_demo','Inactive Demo','teacher','x','x',0),('active_demo','Active Demo','teacher','x','x',1)");
   const inactive=db.prepare("SELECT id FROM users WHERE username='inactive_demo'").get().id;
   const active=db.prepare("SELECT id FROM users WHERE username='active_demo'").get().id;
   const ids=db.prepare('SELECT id FROM classrooms ORDER BY id LIMIT 2').all().map(x=>x.id);
   db.prepare('UPDATE classrooms SET advisor_user_id=? WHERE id=?').run(inactive,ids[0]);
   db.prepare('UPDATE classrooms SET advisor_user_id=?,advisor2_user_id=? WHERE id=?').run(active,active,ids[1]);
  }finally{db.close()}
  const db2=new DatabaseSync(f.file,{readOnly:true});
  let result;try{result=inspectAdvisorCoverage(db2)}finally{db2.close()}
  assert.equal(result.invalid.length,2);
  assert.ok(result.invalid.some(x=>x.reasons.includes('primary_inactive_or_invalid')));
  assert.ok(result.invalid.some(x=>x.reasons.includes('same_teacher_in_two_slots')));
 }finally{f.cleanup()}
});
