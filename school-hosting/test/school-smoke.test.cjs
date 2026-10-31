'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const {migrate,CONFIRM,fileSet}=require('../migrate.cjs');
const {openLocalD1,privateDbPath}=require('../d1-sqlite.cjs');
const {cleanUrl,settings}=require('../server.cjs');
const root=path.resolve(__dirname,'../..');
function tempDb(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-sqlite-'));
 const file=path.join(dir,'student-data.sqlite');
 const clean=()=>fs.rmSync(dir,{recursive:true,force:true});
 return {dir,file,clean};
}
test('full original Worker migration chain works on server-local native SQLite',()=>{
 const t=tempDb();
 try{
  assert.ok(fileSet().length>=46);
  const logs=[];
  const result=migrate({filename:t.file,confirm:CONFIRM,log:x=>logs.push(x)});
  assert.equal(result.migrations,fileSet().length);
  assert.ok(logs.some(x=>x.includes('FOREIGN KEYS: OK')));
  const db=new DatabaseSync(t.file,{readOnly:true});
  try{
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM classrooms').get().n,48);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM students').get().n,0);
   const accounts=db.prepare('SELECT username,role,active FROM users').all();
   assert.deepEqual(accounts,[{username:'rd-care-late-system',role:'staff',active:0}]);
   assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
   assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close()}
  migrate({filename:t.file,confirm:CONFIRM,log(){}});
  assert.throws(()=>migrate({filename:t.file,confirm:'bad',log(){}}),
   /confirmation_required/);
 }finally{t.clean()}
});
test('D1 SQL first/all/run, boolean binding and atomic batch behave correctly',async()=>{
 const t=tempDb();
 try{
  const raw=new DatabaseSync(t.file);
  raw.exec('CREATE TABLE items (id INTEGER PRIMARY KEY,flag INTEGER NOT NULL UNIQUE)');
  raw.close();
  const db=openLocalD1({filename:t.file,webRoot:path.join(root,'web')});
  try{
   const p=db.prepare('INSERT INTO items(flag) VALUES(?)');
   const created=await p.bind(true).run();
   assert.equal(created.meta.changes,1);
   assert.equal(created.meta.last_row_id,1);
   const row=await db.prepare('SELECT flag FROM items WHERE id=?').bind(1).first();
   assert.deepEqual(row,{flag:1});
   assert.equal(await db.prepare('SELECT flag FROM items').first('flag'),1);
   assert.equal((await db.prepare('SELECT id FROM items').all()).results.length,1);
   await assert.rejects(()=>db.batch([
    db.prepare('INSERT INTO items(flag) VALUES(?)').bind(false),
    db.prepare('INSERT INTO items(flag) VALUES(?)').bind(true)
   ]),/UNIQUE constraint failed/);
   assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM items').first()).n,1);
   const results=await db.batch([
    db.prepare('INSERT INTO items(flag) VALUES(?)').bind(false),
    db.prepare('SELECT COUNT(*) AS n FROM items')
   ]);
   assert.equal(results[0].meta.changes,1);
   assert.equal(results[1].results[0].n,2);
  }finally{db.close()}
 }finally{t.clean()}
});
test('private DB cannot be stored in public web directory',()=>{
 const t=tempDb();
 try{
  assert.throws(()=>privateDbPath(path.join(root,'web','student.db'),
   path.join(root,'web')),/outside_webroot/);
  assert.throws(()=>privateDbPath('relative.sqlite',path.join(root,'web')),
   /absolute_path/);
  assert.equal(privateDbPath(t.file,path.join(root,'web')),t.file);
 }finally{t.clean()}
});
test('request routing is deterministic and cannot traverse webroot',()=>{
 assert.equal(cleanUrl('/web/rd-connect/api/auth/me','/web/rd-connect').pathname,'/api/auth/me');
 assert.equal(cleanUrl('/web/rd-connect/?login=student','/web/rd-connect').pathname,'/');
 assert.equal(cleanUrl('/api/health','/web/rd-connect').pathname,'/api/health');
 for(const bad of ['//other.example/file','/web/rd-connect/%2e%2e/secrets',
   '/web/rd-connect/%2Fetc/passwd','/web/rd-connect/.env'])
  assert.throws(()=>cleanUrl(bad,'/web/rd-connect'),/school_invalid_url/);
 assert.deepEqual(settings({RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
  RD_APP_MOUNT:'/web/rd-connect',RD_SQLITE_FILE:'/private/school.sqlite'}),
  {origin:'https://ratsada.ac.th',mount:'/web/rd-connect',file:'/private/school.sqlite'});
});
test('unmodified Worker can answer health and setup/admin login using school-local D1',async()=>{
 const t=tempDb();
 try{
  migrate({filename:t.file,confirm:CONFIRM,log(){}});
  const db=openLocalD1({filename:t.file,webRoot:path.join(root,'web')});
  try{
   const mod=await import(pathToFileURL(path.join(root,'worker/src/worker.js')).href);
   const worker=mod.default;
   const env={DB:db,ALLOWED_ORIGINS:'https://school.example',
    SETUP_TOKEN:'a'.repeat(64)};
   const ctx={waitUntil(){}};
   async function post(url,body,headers={}){
    return worker.fetch(new Request('https://school.example'+url,{
     method:'POST',headers:{'content-type':'application/json',...headers},
     body:JSON.stringify(body)
    }),env,ctx);
   }
   const health=await worker.fetch(new Request('https://school.example/api/health'),
    env,ctx);
   assert.equal(health.status,200);
   assert.equal((await health.json()).ok,true);
   const setup=await post('/api/setup',{username:'testadmin',
    display_name:'Synthetic Admin',password:'fictional-long-admin-password'},
    {'x-setup-token':'a'.repeat(64)});
   assert.equal(setup.status,201);
   const login=await post('/api/auth/login',{username:'testadmin',
    password:'fictional-long-admin-password'});
   assert.equal(login.status,200);
   const data=await login.json();
   assert.match(data.token,/^[a-f0-9]{64}$/);
   assert.equal(data.user.role,'admin');
   const rooms=await worker.fetch(new Request('https://school.example/api/classrooms',{
    headers:{authorization:'Bearer '+data.token}}),env,ctx);
   assert.equal(rooms.status,200);
   assert.equal((await rooms.json()).items.length,48);
  }finally{db.close()}
 }finally{t.clean()}
});
