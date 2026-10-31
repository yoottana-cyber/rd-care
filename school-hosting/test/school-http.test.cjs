'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {migrate,CONFIRM}=require('../migrate.cjs');
const {createHandler}=require('../server.cjs');

test('school-hosted PWA and original Worker API respond on the same mount',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rd-school-http-'));
 const file=path.join(dir,'school.sqlite');
 let server,db;
 try{
  migrate({filename:file,confirm:CONFIRM,log(){}});
  const env={RD_PUBLIC_ORIGIN:'https://ratsada.ac.th',
   RD_APP_MOUNT:'/web/rd-connect',RD_SQLITE_FILE:file};
  const app=await createHandler(env);
  db=app.db;
  server=http.createServer((req,res)=>{void app.handler(req,res)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const redirect=await fetch(origin+'/web/rd-connect?login=staff',{redirect:'manual'});
  assert.equal(redirect.status,308);
  assert.equal(redirect.headers.get('location'),'/web/rd-connect/?login=staff');
  const page=await fetch(origin+'/web/rd-connect/');
  assert.equal(page.status,200);
  assert.match(await page.text(),/RD CONNECT/);
  const js=await fetch(origin+'/web/rd-connect/config.js');
  assert.equal(js.status,200);
  assert.match(await js.text(),/API_BASE_URL/);
  const health=await fetch(origin+'/web/rd-connect/api/health');
  assert.equal(health.status,200);
  assert.equal((await health.json()).ok,true);
  const forbidden=await fetch(origin+'/web/rd-connect/api/health',{
   headers:{origin:'https://attacker.example'}});
  assert.equal(forbidden.status,403);
  const traversal=await fetch(origin+'/web/rd-connect/.env');
  assert.equal(traversal.status,400);
  const noMethod=await fetch(origin+'/web/rd-connect/config.js',{method:'POST'});
  assert.equal(noMethod.status,405);
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(db)db.close();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
