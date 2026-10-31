'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {openLocalD1}=require('../d1-sqlite.cjs');
const {pathToFileURL}=require('node:url');
const entry=pathToFileURL(path.resolve(__dirname,'../../worker/src/advisor-import.js')).href;
const endpoint=()=>import(entry).then(m=>m.advisorImportEndpoint);
function withDb(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-overwrite-synthetic-'));
 const privateDir=path.join(dir,'private');fs.mkdirSync(privateDir,{mode:0o700});
 const filename=path.join(privateDir,'sample.sqlite');
 migrate({filename,confirm:CONFIRM,log(){}});
 return {filename,cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const admin={id:1,role:'admin'};
const request=(rows)=>new Request('https://example.school/api/admin/advisors/commit',{
 method:'POST',body:JSON.stringify({existingMode:'replace',advisors:rows})
});
test('actual SQLite full-room replacement updates only supplied classroom, clears second slot and keeps other room',async()=>{
 const fixture=withDb();
 let d1;
 try{
  const sqlite=new DatabaseSync(fixture.filename);
  sqlite.exec('PRAGMA foreign_keys=ON');
  const insert=sqlite.prepare("INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,1)");
  for(const [username,role] of [['old001','teacher'],['old002','teacher'],['keep003','staff']])
   insert.run(username,username,role,'synthetic-salt','synthetic-hash');
  const ids=Object.fromEntries(sqlite.prepare("SELECT id,username FROM users WHERE username IN ('old001','old002','keep003')").all().map(x=>[x.username,x.id]));
  const rooms=sqlite.prepare("SELECT id,label FROM classrooms WHERE label IN ('ม.1/1','ม.1/2')").all();
  assert.equal(rooms.length,2,'synthetic room catalog exists');
  const r1=rooms.find(x=>x.label==='ม.1/1'),r2=rooms.find(x=>x.label==='ม.1/2');
  sqlite.prepare('UPDATE classrooms SET advisor_user_id=?,advisor2_user_id=? WHERE id=?')
   .run(ids.old001,ids.old002,r1.id);
  sqlite.prepare('UPDATE classrooms SET advisor_user_id=? WHERE id=?').run(ids.old002,r2.id);
  sqlite.close();
  d1=openLocalD1({filename:fixture.filename,webRoot:path.resolve(__dirname,'../../web')});
  const action=await endpoint();
  const data=await (await action(request([
   {classroom:'ม.1/1',full_name:'keep003',username:'keep003',password:'',source_row:2}
  ]),{DB:d1},admin,'/api/admin/advisors/commit')).json();
  assert.equal(data.ok,true);
  assert.equal(data.replacedRooms,1);
  assert.equal(data.created,0);
  const got=await d1.prepare("SELECT label,advisor_user_id,advisor2_user_id FROM classrooms WHERE label IN ('ม.1/1','ม.1/2')").all();
  const one=got.results.find(x=>x.label==='ม.1/1'),two=got.results.find(x=>x.label==='ม.1/2');
  assert.equal(one.advisor_user_id,ids.keep003);
  assert.equal(one.advisor2_user_id,null);
  assert.equal(two.advisor_user_id,ids.old002);
  assert.equal(two.advisor2_user_id,null);
  const audit=await d1.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='advisor_bulk_room_replaced'").first();
  assert.equal(audit.n,1);
  const duplicate=await (await action(request([
   {classroom:'ม.1/1',full_name:'keep003',username:'keep003',password:'',source_row:2}
  ]),{DB:d1},admin,'/api/admin/advisors/commit')).json();
  assert.equal(duplicate.replacedRooms,0);
  assert.equal(duplicate.skipped,1);
 }finally{
  if(d1)d1.close();
  fixture.cleanup();
 }
});
test('actual SQLite: updating a 2-advisor room assigns both new users in one transaction',async()=>{
 const fixture=withDb();let d1;
 try{
  const sqlite=new DatabaseSync(fixture.filename);
  sqlite.exec('PRAGMA foreign_keys=ON');
  const insert=sqlite.prepare("INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,1)");
  for(const username of ['old001','old002','new001','new002'])
   insert.run(username,username,'teacher','synthetic-salt','synthetic-hash');
  const ids=Object.fromEntries(sqlite.prepare("SELECT id,username FROM users WHERE username IN ('old001','old002','new001','new002')").all().map(x=>[x.username,x.id]));
  sqlite.prepare("UPDATE classrooms SET advisor_user_id=?,advisor2_user_id=? WHERE label='ม.1/1'")
   .run(ids.old001,ids.old002);
  sqlite.close();
  d1=openLocalD1({filename:fixture.filename,webRoot:path.resolve(__dirname,'../../web')});
  const action=await endpoint();
  const data=await (await action(request([
   {classroom:'ม.1/1',full_name:'new001',username:'new001',password:''},
   {classroom:'ม.1/1',full_name:'new002',username:'new002',password:''}
  ]),{DB:d1},admin,'/api/admin/advisors/commit')).json();
  assert.equal(data.ok,true);
  assert.equal(data.replacedRooms,1);
  const updated=await d1.prepare("SELECT advisor_user_id,advisor2_user_id FROM classrooms WHERE label='ม.1/1'").first();
  assert.deepEqual([updated.advisor_user_id,updated.advisor2_user_id],[ids.new001,ids.new002]);
 }finally{
  if(d1)d1.close();fixture.cleanup();
 }
});
