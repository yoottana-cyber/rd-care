'use strict';
// Isolated HTTP server worker for the synthetic check-in concurrency lab.
// Only listens on IPv4 loopback with a private disposable SQLite DB.
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {createHandler}=require('./server.cjs');
async function main(){
 const root=process.env.RD_LAB_ROOT;
 const file=process.env.RD_LAB_SQLITE;
 if(process.env.RD_LAB_ONLY!=='SYNTHETIC_NO_SCHOOL_DB'||
  !root||!file||!path.isAbsolute(root)||!path.isAbsolute(file)||
  !path.resolve(file).startsWith(path.resolve(root)+path.sep)||
  !fs.realpathSync(root).startsWith(fs.realpathSync(require('node:os').tmpdir())+path.sep)||
  !path.basename(root).startsWith('rd-connect-load-lab-'))
  throw Error('school_load_test_isolation_required');
 const instance=await createHandler({
  RD_PUBLIC_ORIGIN:'https://rd-load.invalid',
  RD_APP_MOUNT:'/rd-load',
  RD_SQLITE_FILE:file
 });
 const server=http.createServer((req,res)=>{
  void instance.handler(req,res).catch(()=>{
   if(!res.headersSent)res.writeHead(503,{'content-type':'application/json'});
   res.end('{"ok":false,"error":"synthetic_load_request_failed"}');
  });
 });
 server.requestTimeout=20000;
 server.headersTimeout=10000;
 server.listen(0,'127.0.0.1',()=>{
  if(process.send)process.send({type:'READY',port:server.address().port});
 });
 process.on('message',message=>{
  if(message?.type!=='STOP')return;
  server.close(()=>{instance.db.close();process.exit(0)});
 });
}
main().catch(()=>{
 if(process.send)process.send({type:'FAILED',code:'load_lab_child_start_failed'});
 process.exitCode=1;
});
