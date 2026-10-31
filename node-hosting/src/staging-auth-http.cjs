'use strict';
// Stage 6.5: isolated HTTP adapter for existing auth service.
// INTENTIONALLY NOT IMPORTED BY app.js or src/http-handler.cjs.
// Pass an already-authorized DB connection explicitly; never open a pool here.
// No CORS, no cookies, no production routes, no logging of passwords/tokens.
const {TextDecoder}=require('node:util');
const {normalizeAppPath}=require('./http-handler.cjs');
const authService=require('./staging-auth-service.cjs');
const MAX_BODY_BYTES=8192;
const ROUTES=Object.freeze({
 '/api/auth/login':{kind:'staff',action:'login',method:'POST'},
 '/api/auth/me':{kind:'staff',action:'me',method:'GET'},
 '/api/auth/logout':{kind:'staff',action:'logout',method:'POST'},
 '/api/portal/auth/login':{kind:'portal',action:'login',method:'POST'},
 '/api/portal/auth/me':{kind:'portal',action:'me',method:'GET'},
 '/api/portal/auth/logout':{kind:'portal',action:'logout',method:'POST'}
});
function response(res,status,body){
 res.writeHead(status,{
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'"
 });
 res.end(JSON.stringify(body));
}
function requestError(status,code){
 const e=new Error(code);e.status=status;return e;
}
async function readJson(req){
 const type=String(req.headers?.['content-type']||'').split(';')[0].trim().toLowerCase();
 if(type!=='application/json')throw requestError(415,'unsupported_media_type');
 const length=Number(req.headers?.['content-length']||0);
 if(!Number.isFinite(length)||length<0||length>MAX_BODY_BYTES)
  throw requestError(413,'request_too_large');
 let size=0;
 const chunks=[];
 for await(const chunk of req){
  const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  size+=buffer.length;
  if(size>MAX_BODY_BYTES)throw requestError(413,'request_too_large');
  chunks.push(buffer);
 }
 try{
  const json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
  if(!json||typeof json!=='object'||Array.isArray(json))
   throw new Error('not_object');
  return json;
 }catch{throw requestError(400,'invalid_json')}
}
function statusAndCode(error){
 switch(error?.status){
  case 400:return [400,'invalid_request'];
  case 401:return [401,'invalid_credentials'];
  case 403:return [403,'forbidden'];
  case 405:return [405,'method_not_allowed'];
  case 413:return [413,'request_too_large'];
  case 415:return [415,'unsupported_media_type'];
  case 429:return [429,'too_many_attempts'];
  default:return [503,'auth_unavailable'];
 }
}
async function handleStagingAuthRequest(req,res,{connection,services=authService}={}){
 // Do not allow calling the adapter without explicit connection injection.
 if(!connection)return response(res,503,{ok:false,error:'auth_unavailable'});
 let path;
 try{path=normalizeAppPath(new URL(req.url||'/','http://local.invalid').pathname)}
 catch{return response(res,400,{ok:false,error:'invalid_request'})}
 const route=ROUTES[path];
 if(!route)return response(res,404,{ok:false,error:'not_found'});
 if(req.method!==route.method)return response(res,405,{ok:false,error:'method_not_allowed'});
 try{
  let result;
  if(route.action==='login'){
   const body=await readJson(req);
   result=await services.login(connection,{kind:route.kind,body});
  }else if(route.action==='me'){
   result=await services.me(connection,{
    kind:route.kind,authorization:req.headers?.authorization
   });
  }else{
   result=await services.logout(connection,{
    kind:route.kind,authorization:req.headers?.authorization
   });
  }
  return response(res,200,result);
 }catch(error){
  const [status,code]=statusAndCode(error);
  // Never echo SQL errors, user-supplied bodies or secret token values.
  return response(res,status,{ok:false,error:code});
 }
}
module.exports={MAX_BODY_BYTES,ROUTES,readJson,statusAndCode,handleStagingAuthRequest};
