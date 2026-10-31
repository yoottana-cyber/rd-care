'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {createHandler,settings,cleanUrl}=require('../server.cjs');
const {run:makeAdmin,CONFIRM:ADMIN_CONFIRM}=require('../setup-admin.cjs');

test('school subdomain root mount is normalized and rejects unsafe paths',()=>{
 assert.deepEqual(settings({
  RD_PUBLIC_ORIGIN:'https://rd-connect.ratsada.ac.th',
  RD_APP_MOUNT:'/',
  RD_SQLITE_FILE:'/private/school.sqlite'
 }),{
  origin:'https://rd-connect.ratsada.ac.th',
  mount:'/',
  file:'/private/school.sqlite'
 });
 assert.equal(cleanUrl('/?login=staff','/').pathname,'/');
 assert.equal(cleanUrl('/api/auth/login','/').pathname,'/api/auth/login');
 assert.equal(cleanUrl('/config.js','/').pathname,'/config.js');
 for(const bad of ['//bad.example/api/health','/%2e%2e/secrets','/.env','/%2Fetc/passwd']){
  assert.throws(()=>cleanUrl(bad,'/'),/school_invalid_url/);
 }
});
test('subdomain root serves frontend and local SQLite auth with no external API',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-subdomain-'));
 const file=path.join(dir,'school.sqlite');
 let server,db;
 try{
  migrate({filename:file,confirm:CONFIRM,log(){}});
  await makeAdmin({env:{
   RD_SQLITE_FILE:file,RD_SCHOOL_ADMIN_CONFIRM:ADMIN_CONFIRM,
   RD_SETUP_USERNAME:'schooladmin',RD_SETUP_DISPLAY_NAME:'Synthetic Admin',
   RD_SETUP_PASSWORD:'synthetic-subdomain-test-password'
  },log(){}});
  const app=await createHandler({
   RD_PUBLIC_ORIGIN:'https://rd-connect.ratsada.ac.th',
   RD_APP_MOUNT:'/',
   RD_SQLITE_FILE:file
  });
  db=app.db;
  server=http.createServer((req,res)=>{void app.handler(req,res)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const page=await fetch(url+'/',{redirect:'manual'});
  assert.equal(page.status,200);
  assert.match(await page.text(),/RD CONNECT/);
  const config=await fetch(url+'/config.js');
  assert.equal(config.status,200);
  assert.match(await config.text(),/API_BASE_URL/);
  const health=await fetch(url+'/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  const login=await fetch(url+'/api/auth/login',{
   method:'POST',
   headers:{'Content-Type':'application/json','Origin':'https://rd-connect.ratsada.ac.th'},
   body:JSON.stringify({username:'schooladmin',password:'synthetic-subdomain-test-password'})
  });
  assert.equal(login.status,200);
  const logged=await login.json();
  assert.match(logged.token,/^[a-f0-9]{64}$/);
  const rooms=await fetch(url+'/api/classrooms',{
   headers:{Authorization:'Bearer '+logged.token}
  });
  assert.equal(rooms.status,200);
  assert.equal((await rooms.json()).items.length,48);
  const setup=await fetch(url+'/api/setup',{method:'POST',
   headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(setup.status,404);
  const otherOrigin=await fetch(url+'/api/health',{
   headers:{Origin:'https://example.invalid'}
  });
  assert.equal(otherOrigin.status,403);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)db.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
