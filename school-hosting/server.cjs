'use strict';
// Fastest SELF-HOSTED RD CONNECT runtime: reuse the original Cloudflare Worker
// unchanged, execute its SQLite migrations on a PRIVATE server-local SQLite DB,
// and serve the existing PWA under the school's HTTPS Passenger application.
// Do NOT point this at MariaDB. This is a different migration option.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {openLocalD1}=require('./d1-sqlite.cjs');
const {fileSet}=require('./migrate.cjs');
const ROOT=path.resolve(__dirname,'..');
const WEB_ROOT=path.join(ROOT,'web');
const WORKER_ENTRY=path.join(ROOT,'worker','src','worker.js');
const TYPES=Object.freeze({
 '.html':'text/html; charset=utf-8',
 '.js':'text/javascript; charset=utf-8',
 '.css':'text/css; charset=utf-8',
 '.json':'application/json; charset=utf-8',
 '.webmanifest':'application/manifest+json',
 '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg',
 '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon',
 '.woff':'font/woff','.woff2':'font/woff2',
 '.csv':'text/csv; charset=utf-8','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
});
function settings(env=process.env){
 const origin=env.RD_PUBLIC_ORIGIN;
 if(typeof origin!=='string')throw Error('school_public_origin_required');
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.username||url.password||
  url.pathname!=='/'||url.search||url.hash)throw Error('school_https_origin_required');
 const mount=env.RD_APP_MOUNT||'/web/rd-connect';
 if((mount!=='/'&&!/^\/[a-z0-9/-]+$/.test(mount))||
  (mount!=='/'&&mount.endsWith('/'))||
  mount.includes('//')||mount.includes('/../'))throw Error('school_invalid_mount');
 const file=env.RD_SQLITE_FILE;
 if(!file)throw Error('school_db_config_missing');
 return {origin:url.origin,mount,file};
}
function cleanUrl(raw,mount){
 if(typeof raw!=='string'||!raw.startsWith('/')||raw.startsWith('//')||
  raw.length>4096||/%2e|%2f|%5c|%00/i.test(raw)||
  raw.split('?')[0].split('/').some(x=>x==='..'||x==='.') )
  throw Error('school_invalid_url');
 const url=new URL(raw,'https://internal.invalid');
 // Some Passenger configurations retain the mount prefix, others strip it.
 const relative=url.pathname===mount?'/':
  url.pathname.startsWith(mount+'/')?url.pathname.slice(mount.length):
  url.pathname;
 if(relative.includes('\\')||/%2f|%5c|%00/i.test(relative))
  throw Error('school_invalid_url');
 let decoded;
 try{decoded=decodeURIComponent(relative)}catch{throw Error('school_invalid_url')}
 if(!decoded.startsWith('/')||decoded.split('/').some(x=>x==='..'||x==='.'||
  x.startsWith('.')||x.includes('\\')||x.includes('\0')))
  throw Error('school_invalid_url');
 return {pathname:relative,query:url.search,decoded};
}
function commonHeaders(){
 return {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Cross-Origin-Resource-Policy':'same-origin'};
}
function fail(res,status,error){
 res.writeHead(status,{...commonHeaders(),
  'Content-Type':'application/json; charset=utf-8'});
 res.end(JSON.stringify({ok:false,error}));
}
function staticFile(req,res,location){
 if(!['GET','HEAD'].includes(req.method))return fail(res,405,'method_not_allowed');
 const entry=location.decoded==='/'?'/index.html':location.decoded;
 const fullname=path.resolve(WEB_ROOT,'.'+entry);
 if(!fullname.startsWith(WEB_ROOT+path.sep))return fail(res,404,'not_found');
 const extension=path.extname(fullname).toLowerCase();
 if(!Object.prototype.hasOwnProperty.call(TYPES,extension))
  return fail(res,404,'not_found');
 let real,stat;
 try{
  real=fs.realpathSync(fullname);
  stat=fs.statSync(real);
 }catch{return fail(res,404,'not_found')}
 if(!real.startsWith(WEB_ROOT+path.sep)||!stat.isFile()||stat.size>16*1024*1024)
  return fail(res,404,'not_found');
 res.writeHead(200,{...commonHeaders(),
  'Content-Type':TYPES[extension],'Content-Length':stat.size});
 if(req.method==='HEAD')return res.end();
 const stream=fs.createReadStream(real);
 stream.on('error',()=>res.destroy());
 stream.pipe(res);
}
function approvedOrigin(req,origin){
 const supplied=req.headers?.origin;
 return typeof supplied!=='string'||supplied===origin;
}
const MAX_API_BYTES=768*1024;
async function boundedPostBody(req){
 const announced=Number(req.headers?.['content-length']||0);
 if(!Number.isFinite(announced)||announced<0||announced>MAX_API_BYTES)
  throw Error('school_request_too_large');
 let total=0;
 const chunks=[];
 for await(const chunk of req){
  total+=chunk.length;
  if(total>MAX_API_BYTES)throw Error('school_request_too_large');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}
async function schoolHandler(req,res,{worker,db,env,config}){
 let where;
 try{where=cleanUrl(req.url,config.mount)}
 catch{return fail(res,400,'invalid_request')}
 if(config.mount!=='/'&&req.url.split('?')[0]===config.mount){
  res.writeHead(308,{...commonHeaders(),
   Location:config.mount+'/'+where.query});
  return res.end();
 }
 if(!where.pathname.startsWith('/api/'))
  return staticFile(req,res,where);
 // One-time administrator bootstrap is CLI-only; never expose the
 // original Worker /api/setup endpoint on the public school URL.
 if(where.pathname==='/api/setup')return fail(res,404,'not_found');
 if(!approvedOrigin(req,config.origin))return fail(res,403,'origin_not_allowed');
 const method=req.method||'GET';
 if(!['GET','POST','OPTIONS'].includes(method))
  return fail(res,405,'method_not_allowed');
 const headers=new Headers();
 for(const name of ['authorization','content-type','accept','x-setup-token','origin']){
  const value=req.headers?.[name];
  if(typeof value==='string')headers.set(name,value);
 }
 const requestedUrl=config.origin+where.pathname+where.query;
 let request;
 try{
  const body=method==='POST'?await boundedPostBody(req):undefined;
  request=new Request(requestedUrl,{method,headers,
   ...(method==='POST'?{body}:{})});
 }catch(e){
  return fail(res,e?.message==='school_request_too_large'?413:400,
   e?.message==='school_request_too_large'?'request_too_large':'invalid_request');
 }
 const jobs=[];
 const ctx={waitUntil(p){
  jobs.push(Promise.resolve(p).catch(()=>{}));
 }};
 try{
  const result=await worker.fetch(request,{
   ...env,DB:db,ALLOWED_ORIGINS:config.origin,
   RD_SCHOOL_APP_URL:config.origin+(config.mount==='/'?'/':config.mount+'/')
  },ctx);
  const responseHeaders={...commonHeaders()};
  // Do not proxy unsafe CORS/cookies, and never cache authenticated data.
  const contentType=result.headers.get('content-type');
  if(contentType)responseHeaders['Content-Type']=contentType;
  res.writeHead(result.status,responseHeaders);
  if(method==='OPTIONS'||!result.body)return res.end();
  const buffer=Buffer.from(await result.arrayBuffer());
  res.end(buffer);
 }catch{
  fail(res,503,'school_service_unavailable');
 }
 // Scheduled work launched with ctx.waitUntil may finish after response;
 // its own error handling must not expose student data in logs.
 void Promise.allSettled(jobs);
}
function verifyReady(sqlite){
 const rows=sqlite.sqlite.prepare('SELECT filename,sha256 FROM school_schema_migrations').all();
 const expected=fileSet();
 if(rows.length!==expected.length)throw Error('school_migrations_pending');
 const hashes=new Map(rows.map(x=>[x.filename,x.sha256]));
 if(expected.some(x=>hashes.get(x.name)!==x.sha))
  throw Error('school_migration_checksums_changed');
 const state=sqlite.sqlite.prepare('PRAGMA integrity_check').get();
 if(state.integrity_check!=='ok')throw Error('school_database_not_integral');
}
async function createHandler(env=process.env){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_node_24_required');
 const config=settings(env);
 const db=openLocalD1({filename:config.file,webRoot:WEB_ROOT});
 try{verifyReady(db)}catch(e){db.close();throw e}
 const mod=await import(pathToFileURL(WORKER_ENTRY).href);
 if(typeof mod.default?.fetch!=='function'){
  db.close();throw Error('school_worker_entry_invalid');
 }
 const worker=mod.default;
 const handler=(req,res)=>schoolHandler(req,res,{worker,db,env,config});
 return {handler,db,worker,config};
}
async function start(env=process.env){
 const {handler,db}=await createHandler(env);
 const port=Number(env.PORT||3000);
 if(!Number.isInteger(port)||port<1||port>65535){
  db.close();throw Error('school_invalid_port')
 }
 const server=http.createServer((req,res)=>{
  void handler(req,res).catch(()=>fail(res,503,'school_request_failed'));
 });
 server.requestTimeout=15000;
 server.headersTimeout=10000;
 server.listen(port,()=>console.info('RD CONNECT school-local Node/SQLite server started'));
 server.on('close',()=>db.close());
 return server;
}
module.exports={ROOT,WEB_ROOT,TYPES,settings,cleanUrl,staticFile,
 commonHeaders,approvedOrigin,MAX_API_BYTES,boundedPostBody,schoolHandler,verifyReady,createHandler,start};
