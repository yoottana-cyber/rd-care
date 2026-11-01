'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {settings,cleanUrl,createHandler}=require('../server.cjs');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {run:makeAdmin,CONFIRM:ADMIN_CONFIRM}=require('../setup-admin.cjs');

test('subdomain root mount is valid; invalid mount paths still rejected',()=>{
 const env={RD_PUBLIC_ORIGIN:'https://rd-connect.ratsada.ac.th',
  RD_APP_MOUNT:'/',RD_SQLITE_FILE:'/private/rd-connect.sqlite'};
 assert.deepEqual(settings(env),{origin:'https://rd-connect.ratsada.ac.th',
  mount:'/',file:'/private/rd-connect.sqlite'});
 assert.equal(cleanUrl('/?login=staff','/').pathname,'/');
 assert.equal(cleanUrl('/api/auth/me','/').pathname,'/api/auth/me');
 assert.equal(cleanUrl('/manifest-staff.webmanifest','/').pathname,'/manifest-staff.webmanifest');
 for(const bad of ['//attacker.example/path','/%2e%2e/secret','/%2fetc%2fpasswd','/.env'])
  assert.throws(()=>cleanUrl(bad,'/'),/school_invalid_url/);
 for(const bad of ['//','/web//app','/web/','/./','/../'])
  assert.throws(()=>settings({...env,RD_APP_MOUNT:bad}),/school_invalid_mount/);
});
test('existing school Worker/SQLite runs at HTTPS subdomain root, protects API and emits root QR links',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rd-subdomain-root-'));
 const file=path.join(tmp,'synthetic.sqlite');let app,server;
 try{
  migrate({filename:file,confirm:CONFIRM,log(){}});
  await makeAdmin({env:{RD_SQLITE_FILE:file,RD_SCHOOL_ADMIN_CONFIRM:ADMIN_CONFIRM,
   RD_SETUP_USERNAME:'rootadmin',RD_SETUP_DISPLAY_NAME:'Fictional Admin',
   RD_SETUP_PASSWORD:'safe-synthetic-school-password'},log(){}});
  app=await createHandler({RD_PUBLIC_ORIGIN:'https://rd-connect.ratsada.ac.th',
   RD_APP_MOUNT:'/',RD_SQLITE_FILE:file});
  server=http.createServer((req,res)=>{void app.handler(req,res)});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  const base='http://127.0.0.1:'+server.address().port;
  const page=await fetch(base+'/?login=staff',{redirect:'manual'});
  assert.equal(page.status,200,'root must serve PWA and never redirect to //');
  assert.match(await page.text(),/RD CONNECT/);
  const script=await fetch(base+'/config.js');
  assert.equal(script.status,200);
  assert.match(await script.text(),/API_BASE_URL/);
  const manifest=await fetch(base+'/manifest-staff.webmanifest');
  assert.equal(manifest.status,200);
  assert.equal((await manifest.json()).start_url,'./?login=staff');
  const health=await fetch(base+'/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  const login=await fetch(base+'/api/auth/login',{method:'POST',
   headers:{'content-type':'application/json'},
   body:JSON.stringify({username:'rootadmin',password:'safe-synthetic-school-password'})});
  assert.equal(login.status,200);
  const {token}=await login.json();
  const headers={authorization:'Bearer '+token};
  const rooms=await fetch(base+'/api/classrooms',{headers});
  assert.equal(rooms.status,200);
  assert.equal((await rooms.json()).items.length,48);
  const qr=await fetch(base+'/api/late/qr/print',{headers});
  assert.equal(qr.status,200);
  assert.equal((await qr.json()).url,'https://rd-connect.ratsada.ac.th/?late_qr=gate');
  const wrongOrigin=await fetch(base+'/api/health',
   {headers:{origin:'https://ratsada.ac.th'}});
  assert.equal(wrongOrigin.status,403);
  const setup=await fetch(base+'/api/setup',{method:'POST',
   headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(setup.status,404);
  const dotEnv=await fetch(base+'/.env');
  assert.notEqual(dotEnv.status,200,'do not expose hidden files');
 }finally{
  if(server)await new Promise(ok=>server.close(ok));
  if(app)app.db.close();
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
