'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {openLocalD1}=require('../d1-sqlite.cjs');
const uri=pathToFileURL(path.resolve(__dirname,'../../worker/src/student-affairs.js')).href;
const send=(grade,teacher_user_id)=>new Request('https://test.school/api/affairs/heads',{
 method:'POST',body:JSON.stringify({grade,teacher_user_id})
});
test('real synthetic SQLite permits active staff user as grade head without touching role or passwords',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rd-affairs-head-'));
 const folder=path.join(tmp,'private');fs.mkdirSync(folder,{mode:0o700});
 const filename=path.join(folder,'fixture.sqlite');let db;
 try{
  migrate({filename,confirm:CONFIRM,log(){}});
  const sql=new DatabaseSync(filename);
  const insert=sql.prepare("INSERT INTO users(username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?)");
  insert.run('staff_head','ฝ่ายกิจการคนหนึ่ง','staff','unchanged-salt','unchanged-hash',1);
  insert.run('inactive_staff','ฝ่ายกิจการพักบัญชี','staff','unchanged-salt','unchanged-hash',0);
  const staff=sql.prepare("SELECT id FROM users WHERE username='staff_head'").get().id;
  const inactive=sql.prepare("SELECT id FROM users WHERE username='inactive_staff'").get().id;
  sql.close();
  db=openLocalD1({filename,webRoot:path.resolve(__dirname,'../../web')});
  const {studentAffairsRoutes}=await import(uri);
  const actor={id:staff,role:'staff'};
  const ok=await studentAffairsRoutes(send(3,staff),{DB:db},actor,'/api/affairs/heads');
  assert.equal(ok.status,200);
  assert.equal((await db.prepare('SELECT teacher_user_id FROM affairs_grade_heads WHERE grade=3').first()).teacher_user_id,staff);
  const user=await db.prepare("SELECT role,password_salt,password_hash FROM users WHERE id=?").bind(staff).first();
  assert.deepEqual(user,{role:'staff',password_salt:'unchanged-salt',password_hash:'unchanged-hash'});
  const roster=await studentAffairsRoutes(new Request('https://test.school/api/affairs/people'),
   {DB:db},actor,'/api/affairs/people');
  const data=await roster.json();
  assert.equal(data.teachers.find(t=>t.id===staff).username,'staff_head');
  assert.equal(data.heads.find(h=>h.grade===3).teacher_user_id,staff);
  await assert.rejects(studentAffairsRoutes(send(4,inactive),{DB:db},actor,'/api/affairs/heads'),e=>e.code===400);
  assert.equal(await db.prepare('SELECT COUNT(*) AS total FROM affairs_grade_heads WHERE grade=4').first('total'),0);
  await assert.rejects(studentAffairsRoutes(send(4,staff),{DB:db},{id:staff,role:'teacher'},
   '/api/affairs/heads'),e=>e.code===403);
 }finally{if(db)db.close();fs.rmSync(tmp,{recursive:true,force:true})}
});
